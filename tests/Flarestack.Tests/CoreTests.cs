using System.Diagnostics;
using System.Net;
using System.Security.Claims;
using System.Text.Json;
using Flarestack.Authentication.Endpoints;
using Flarestack.Authentication.Transport;
using Flarestack.Authentication.Users;
using Flarestack.D1;
using Microsoft.Extensions.Logging.Abstractions;
using Todo.Web;
using Xunit;

namespace Flarestack.Tests;

public class CoreTests
{
    [Theory]
    [InlineData("/todos", true)]
    [InlineData("//evil.test", false)]
    [InlineData("/\\evil.test", false)]
    [InlineData("https://evil.test", false)]
    [InlineData("/todos\n", false)]
    public void ReturnUrlIsLocal(string url, bool valid) => Assert.Equal(valid, FlarestackAuthentication.IsLocalReturnUrl(url));
    [Fact]
    public void BackchannelOnlyRewritesExactOrigin()
    {
        var authority = new Uri("https://todo.test/auth"); var backchannel = new Uri("http://auth.internal");
        Assert.Equal("http://auth.internal/auth/token?a=1", AuthorityBackchannelHandler.Rewrite(new("https://todo.test/auth/token?a=1"), authority, backchannel).AbsoluteUri);
        foreach (var url in new[] { "https://evil.test/auth", "http://todo.test/auth", "https://todo.test:8443/auth", "https://todo.test.evil/auth" }) Assert.Equal(url, AuthorityBackchannelHandler.Rewrite(new(url), authority, backchannel).AbsoluteUri);
    }
    [Fact]
    public void ConvertsAndRejectsParameters()
    {
        Assert.Equal(1, D1Database.ConvertParameter(true)); Assert.Equal(0, D1Database.ConvertParameter(false));
        Assert.Null(D1Database.ConvertParameter(null)); Assert.Equal("text", D1Database.ConvertParameter("text"));
        Assert.Equal("00000000-0000-0000-0000-000000000000", D1Database.ConvertParameter(Guid.Empty));
        Assert.Contains("AAH/", JsonSerializer.Serialize(D1Database.ConvertParameter(new byte[] { 0, 1, 255 })));
        foreach (var value in new object[] { long.MaxValue, double.NaN, new object(), DateTime.SpecifyKind(DateTime.Now, DateTimeKind.Unspecified) }) Assert.Throws<ArgumentException>(() => D1Database.ConvertParameter(value));
    }
    [Fact]
    public async Task MapsRowsAndChecksCardinality()
    {
        var handler = new RecordingHandler("{\"protocolVersion\":1,\"ok\":true,\"rows\":[{\"is_complete\":1,\"created_at\":\"2026-09-19T12:00:00Z\"}],\"correlationId\":\"test\"}");
        var db = Create(handler); var row = await db.QuerySingleOrDefaultAsync<Row>("select ?1", [true]);
        Assert.True(row!.IsComplete); Assert.Equal(2026, row.CreatedAt.Year); Assert.Contains("\"parameters\":[1]", handler.Body);
        handler.Response = "{\"ok\":true,\"rows\":[]}"; Assert.Null(await db.QuerySingleOrDefaultAsync<Row>("select 1"));
        handler.Response = "{\"ok\":true,\"rows\":[{},{}]}"; await Assert.ThrowsAsync<D1CardinalityException>(() => db.QuerySingleOrDefaultAsync<Row>("select 1"));
    }
    [Fact]
    public async Task TodoMutationsAlwaysBindAuthenticatedOwner()
    {
        var handler = new RecordingHandler("{\"ok\":true,\"rowsAffected\":1}"); var identity = new TestCurrentUser(); var repo = new TodoRepository(Create(handler), identity);

        await repo.SetCompleteAsync("someone-elses-id", true);
        Assert.Contains("owner_id=?", handler.Body); Assert.Contains("owner-a", handler.Body); Assert.Contains("someone-elses-id", handler.Body);
        await repo.DeleteAsync("someone-elses-id"); Assert.Contains("owner_id=?", handler.Body); Assert.Contains("owner-a", handler.Body);
        identity.Valid = false;
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => repo.ListAsync());
    }
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task SqlTracingIsOptInAndExcludesBoundParameters(bool enabled)
    {
        using var parent = new Activity(nameof(SqlTracingIsOptInAndExcludesBoundParameters))
            .SetIdFormat(ActivityIdFormat.W3C)
            .Start();
        var spans = new List<Activity>();
        using var listener = new ActivityListener
        {
            ShouldListenTo = source => source.Name == "Flarestack.D1",
            Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllDataAndRecorded,
            ActivityStopped = activity =>
            {
                if (activity.TraceId == parent.TraceId && activity.ParentSpanId == parent.SpanId)
                {
                    spans.Add(activity);
                }
            }
        };
        ActivitySource.AddActivityListener(listener);
        var handler = new RecordingHandler("{\"ok\":true,\"rows\":[]}");
        var db = Create(handler, new() { IncludeSqlInTraces = enabled });
        const string query = "SELECT * FROM todo WHERE owner_id = ?1";
        const string mutation = "DELETE FROM todo WHERE id = ?1";
        await db.QueryAsync<Row>(query, ["private-owner"]);
        handler.Response = "{\"ok\":true,\"rowsAffected\":1}";
        await db.ExecuteAsync(mutation, ["private-id"]);
        handler.Response = "{\"ok\":true,\"results\":[]}";
        await db.BatchAsync([new(query, ["private-owner"], D1CommandKind.Query), new(mutation, ["private-id"])]);
        Assert.Equal(3, spans.Count);
        var statements = new[] { query, mutation, query + ";\n" + mutation };
        for (var i = 0; i < spans.Count; i++)
        {
            Assert.Equal(enabled ? statements[i] : null, spans[i].GetTagItem("db.query.text"));
            Assert.DoesNotContain("private-", JsonSerializer.Serialize(spans[i].TagObjects));
        }
        handler.Response = "{\"ok\":true,\"rows\":[]}";
        await db.QueryAsync<Row>("SELECT 1 /*" + new string('x', 20_000) + "*/");
        if (enabled)
        {
            var text = Assert.IsType<string>(spans[^1].GetTagItem("db.query.text"));
            Assert.Equal(16_384 + " /* truncated */".Length, text.Length);
            Assert.EndsWith(" /* truncated */", text);
        }
        else Assert.Null(spans[^1].GetTagItem("db.query.text"));
    }
    private sealed class TestCurrentUser : ICurrentUser { public bool Valid = true; public Task<ClaimsPrincipal> GetPrincipalAsync(CancellationToken ct = default) => Valid ? Task.FromResult(new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", "owner-a")], "test"))) : throw new UnauthorizedAccessException(); }
    private static D1Database Create(RecordingHandler handler, D1Options? options = null) => new(new HttpClient(handler) { BaseAddress = new("http://d1.internal") }, options ?? new(), NullLogger<D1Database>.Instance);
    public record Row(bool IsComplete, DateTimeOffset CreatedAt);
    private sealed class RecordingHandler(string response) : HttpMessageHandler
    {
        public string Response = response; public string Body = "";
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        { Body = await request.Content!.ReadAsStringAsync(token); var result = new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(Response) }; result.Headers.Add("x-flarestack-protocol", "2"); return result; }
    }
}

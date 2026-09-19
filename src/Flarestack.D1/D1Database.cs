using System.Diagnostics;
using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Flarestack.D1;

public interface ID1Database
{
    Task<IReadOnlyList<T>> QueryAsync<T>(string sql, IReadOnlyList<object?>? parameters = null, CancellationToken cancellationToken = default);
    Task<T?> QuerySingleOrDefaultAsync<T>(string sql, IReadOnlyList<object?>? parameters = null, CancellationToken cancellationToken = default);
    Task<int> ExecuteAsync(string sql, IReadOnlyList<object?>? parameters = null, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<D1CommandResult>> BatchAsync(IReadOnlyList<D1Command> commands, CancellationToken cancellationToken = default);
}
public enum D1CommandKind { Execute, Query }
public sealed record D1Command(string Sql, IReadOnlyList<object?> Parameters, D1CommandKind Kind = D1CommandKind.Execute);
public sealed record D1CommandResult(int RowsAffected, IReadOnlyList<JsonElement>? Rows = null);
public sealed class D1CardinalityException() : Exception("Expected at most one D1 row.");
public sealed class D1Exception(string code, string operation, string correlationId)
    : Exception($"D1 {operation} failed ({code}, correlation {correlationId}).")
{
    public string Code { get; } = code;
    public string Operation { get; } = operation;
    public string CorrelationId { get; } = correlationId;
}
public sealed class D1Options
{
    public string BaseAddress { get; set; } = "http://d1.internal";
    public int TimeoutSeconds { get; set; } = 30;
    public int MaxRequestBytes { get; set; } = 1_048_576;
    public int MaxCommands { get; set; } = 100;
    public bool IncludeSqlInTraces { get; set; }
}
public static class D1Registration
{
    public static IServiceCollection AddFlarestackD1(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection("Flarestack:D1").Get<D1Options>() ?? new();
        if (!Uri.TryCreate(options.BaseAddress, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") || options.TimeoutSeconds <= 0 || options.MaxCommands <= 0 || options.MaxRequestBytes <= 0)
            throw new InvalidOperationException("Invalid Flarestack:D1 configuration.");
        var bridgeToken = configuration["Flarestack:LocalBridgeToken"];
        if (!string.IsNullOrEmpty(bridgeToken) && !uri.IsLoopback) throw new InvalidOperationException("Local bridge credentials require a loopback D1 address.");
        services.AddSingleton(options);
        services.AddHttpClient<ID1Database, D1Database>(client => { client.BaseAddress = uri; client.Timeout = TimeSpan.FromSeconds(options.TimeoutSeconds); if (!string.IsNullOrEmpty(bridgeToken)) client.DefaultRequestHeaders.Add("x-flarestack-bridge", bridgeToken); });
        return services;
    }
}
public sealed class D1Database(HttpClient client, D1Options options, ILogger<D1Database> logger) : ID1Database
{
    public static readonly ActivitySource ActivitySource = new("Flarestack.D1");
    private static readonly JsonSerializerOptions Rows = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        Converters = { new SqliteBooleanConverter() }
    };
    public static object? ConvertParameter(object? value) => value switch
    {
        null or string or byte or sbyte or short or ushort or int or uint => value,
        long n when n is >= -9007199254740991 and <= 9007199254740991 => n,
        ulong n when n <= 9007199254740991 => n,
        float n when float.IsFinite(n) => n,
        double n when double.IsFinite(n) => n,
        bool b => b ? 1 : 0,
        Guid g => g.ToString("D"),
        DateTime d when d.Kind != DateTimeKind.Unspecified => d.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture),
        DateTimeOffset d => d.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture),
        byte[] b => new { type = "base64", value = Convert.ToBase64String(b) },
        _ => throw new ArgumentException($"Unsupported D1 parameter: {value.GetType().Name}. Dates must have a timezone and integers must be JavaScript-safe.")
    };
    private static object Command(string sql, IReadOnlyList<object?>? parameters, string operation)
    {
        if (string.IsNullOrWhiteSpace(sql) || sql.Length > 100_000) throw new ArgumentException("D1 SQL must contain 1–100000 characters.");
        if (parameters?.Count > 100) throw new ArgumentException("D1 supports at most 100 parameters per command.");
        return new { operation, sql, parameters = parameters?.Select(ConvertParameter).ToArray() ?? [] };
    }
    public async Task<IReadOnlyList<T>> QueryAsync<T>(string sql, IReadOnlyList<object?>? parameters = null, CancellationToken cancellationToken = default)
    {
        using var document = await SendAsync("query", Command(sql, parameters, "query"), cancellationToken);
        return document.RootElement.GetProperty("rows").Deserialize<List<T>>(Rows) ?? [];
    }
    public async Task<T?> QuerySingleOrDefaultAsync<T>(string sql, IReadOnlyList<object?>? parameters = null, CancellationToken cancellationToken = default)
    {
        var rows = await QueryAsync<T>(sql, parameters, cancellationToken);
        return rows.Count switch { 0 => default, 1 => rows[0], _ => throw new D1CardinalityException() };
    }
    public async Task<int> ExecuteAsync(string sql, IReadOnlyList<object?>? parameters = null, CancellationToken cancellationToken = default)
    {
        using var document = await SendAsync("execute", Command(sql, parameters, "execute"), cancellationToken);
        return document.RootElement.GetProperty("rowsAffected").GetInt32();
    }
    public async Task<IReadOnlyList<D1CommandResult>> BatchAsync(IReadOnlyList<D1Command> commands, CancellationToken cancellationToken = default)
    {
        if (commands.Count == 0 || commands.Count > options.MaxCommands) throw new ArgumentException("Invalid D1 batch command count.");
        using var document = await SendAsync("batch", new { commands = commands.Select(c => Command(c.Sql, c.Parameters, c.Kind == D1CommandKind.Query ? "query" : "execute")) }, cancellationToken);
        return document.RootElement.GetProperty("results").Deserialize<List<D1CommandResult>>(new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? [];
    }
    private async Task<JsonDocument> SendAsync(string operation, object command, CancellationToken ct)
    {
        using var activity = ActivitySource.StartActivity($"D1 {operation}", ActivityKind.Client);
        activity?.SetTag("db.system.name", "sqlite").SetTag("db.operation.name", operation);
        var fields = JsonSerializer.SerializeToElement(command);
        if (activity?.IsAllDataRequested == true && options.IncludeSqlInTraces)
        {
            // Capture statement text only. Bound parameter values never become span attributes.
            var sql = operation == "batch"
                ? string.Join(";\n", fields.GetProperty("commands").EnumerateArray().Select(c => c.GetProperty("sql").GetString()))
                : fields.GetProperty("sql").GetString()!;
            const int maxSqlLength = 16_384;
            activity.SetTag("db.query.text", sql.Length <= maxSqlLength ? sql : sql[..maxSqlLength] + " /* truncated */");
        }
        var payload = fields.EnumerateObject().ToDictionary(p => p.Name, p => (object?)p.Value);
        payload["protocolVersion"] = 1; payload["operation"] = operation;
        var bytes = JsonSerializer.SerializeToUtf8Bytes(payload);
        if (bytes.Length > options.MaxRequestBytes) throw new ArgumentException("D1 request exceeds configured size limit.");
        using var content = new ByteArrayContent(bytes);
        content.Headers.ContentType = new("application/json");
        using var response = await client.PostAsync("/v1/commands", content, ct);
        var document = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        if (!response.IsSuccessStatusCode || !document.RootElement.GetProperty("ok").GetBoolean())
        {
            var id = document.RootElement.GetProperty("correlationId").GetString() ?? "unknown";
            var code = document.RootElement.GetProperty("error").GetProperty("code").GetString() ?? "D1_FAILURE";
            document.Dispose(); activity?.SetStatus(ActivityStatusCode.Error, code);
            logger.LogError("D1 {Operation} failed: {Code}, correlation {CorrelationId}", operation, code, id);
            throw new D1Exception(code, operation, id);
        }
        logger.LogInformation("D1 {Operation} completed", operation);
        return document;
    }
    private sealed class SqliteBooleanConverter : JsonConverter<bool>
    {
        public override bool Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options) => reader.TokenType == JsonTokenType.Number ? reader.GetInt32() != 0 : reader.GetBoolean();
        public override void Write(Utf8JsonWriter writer, bool value, JsonSerializerOptions options) => writer.WriteBooleanValue(value);
    }
}

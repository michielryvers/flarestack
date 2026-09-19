using System.Net;
using System.Security.Claims;
using Flarestack.Authentication;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;
using Xunit;

public class SessionTests
{
    private static ClaimsPrincipal User() => new(new ClaimsIdentity([new("sub","user-1"),new("sid","session-1"),new("role","admin")],"Cookies","name","role"));
    private sealed class State : AuthenticationStateProvider { public override Task<AuthenticationState> GetAuthenticationStateAsync() => Task.FromResult(new AuthenticationState(User())); }
    private sealed class Handler(string result) : HttpMessageHandler
    {
        public int Requests;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) {
            Requests++;
            if(result=="network")throw new HttpRequestException("offline");
            if(result=="timeout")throw new TaskCanceledException();
            var response=new HttpResponseMessage(int.TryParse(result,out var code)?(HttpStatusCode)code:HttpStatusCode.OK) {
                Content=new StringContent(result=="malformed"?"{":result=="empty"?"{}": "{\"id\":\"user-1\",\"email\":\"user@example.test\",\"name\":\"Name\",\"roles\":[\"user\"]}".Replace("user-1",result=="wrong-user"?"user-2":"user-1"))
            };
            response.Headers.Add("x-flarestack-protocol",result=="mismatch"?"1":"2");
            return Task.FromResult(response);
        }
    }
    private sealed class Environment : IHostEnvironment {
        public string EnvironmentName {get;set;}="Development"; public string ApplicationName {get;set;}="Tests";
        public string ContentRootPath {get;set;}="/tmp"; public IFileProvider ContentRootFileProvider {get;set;}=new NullFileProvider();
    }
    private sealed class Authentication : IAuthenticationService {
        public bool SignedOut;
        public Task<AuthenticateResult> AuthenticateAsync(HttpContext c,string? s)=>Task.FromResult(AuthenticateResult.NoResult());
        public Task ChallengeAsync(HttpContext c,string? s,AuthenticationProperties? p)=>Task.CompletedTask;
        public Task ForbidAsync(HttpContext c,string? s,AuthenticationProperties? p)=>Task.CompletedTask;
        public Task SignInAsync(HttpContext c,string? s,ClaimsPrincipal u,AuthenticationProperties? p)=>Task.CompletedTask;
        public Task SignOutAsync(HttpContext c,string? s,AuthenticationProperties? p){SignedOut=true;return Task.CompletedTask;}
    }
    private static ServiceProvider Services(Handler handler,Authentication authentication) {
        var services=new ServiceCollection();services.AddLogging();services.AddSingleton<IHostEnvironment>(new Environment());
        services.AddFlarestackAuthentication(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> {
            ["Flarestack:Authentication:Authority"]="http://localhost:8787/auth",["Flarestack:Authentication:ClientId"]="test"
        }).Build());
        services.AddHttpClient<AccountClient>().ConfigurePrimaryHttpMessageHandler(()=>handler);
        services.AddScoped<AuthenticationStateProvider,State>();services.AddSingleton<IAuthenticationService>(authentication);
        return services.BuildServiceProvider();
    }
    [Theory]
    [InlineData("401")][InlineData("403")][InlineData("500")][InlineData("network")][InlineData("timeout")][InlineData("malformed")][InlineData("mismatch")][InlineData("wrong-user")][InlineData("empty")]
    public async Task CookieFailsClosedWhenLiveSessionCannotBeValidated(string result) {
        var authentication=new Authentication();using var services=Services(new(result),authentication);
        using var scope=services.CreateScope();
        var options=scope.ServiceProvider.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>().Get("Cookies");
        var http=new DefaultHttpContext {RequestServices=scope.ServiceProvider};
        var context=new CookieValidatePrincipalContext(http,new("Cookies",null,typeof(CookieAuthenticationHandler)),options,new(User(),"Cookies"));
        await options.Events.OnValidatePrincipal(context);
        Assert.Null(context.Principal);Assert.True(authentication.SignedOut);
    }
    [Fact]
    public void HttpIssuerIsRejectedOutsideDevelopment() {
        using var services=Services(new("valid"),new());
        services.GetRequiredService<IHostEnvironment>().EnvironmentName="Production";
        Assert.Throws<InvalidOperationException>(()=>services.GetRequiredService<IOptionsMonitor<Microsoft.AspNetCore.Authentication.OpenIdConnect.OpenIdConnectOptions>>().Get("OpenIdConnect"));
    }
    [Fact]
    public async Task CurrentUserRechecksEveryOperationAndAdminCannotUseStaleRole() {
        var handler=new Handler("valid");using var services=Services(handler,new());using var scope=services.CreateScope();
        var current=scope.ServiceProvider.GetRequiredService<ICurrentUser>();
        Assert.Equal("user-1",await current.GetRequiredIdAsync());
        Assert.False((await current.GetPrincipalAsync()).IsInRole("admin"));
        Assert.Equal(2,handler.Requests);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>scope.ServiceProvider.GetRequiredService<IUserAdministration>().SetRoleAsync("other",UserRole.Admin));
        Assert.Equal(3,handler.Requests); // Validation happened; no mutation request followed.
    }
}

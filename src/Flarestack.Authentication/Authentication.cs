using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Flarestack.Authentication;

public sealed class AuthorityBackchannelHandler(Uri authority, Uri backchannel, string? bridgeToken = null) : DelegatingHandler(new HttpClientHandler { AllowAutoRedirect = false })
{
    public static Uri Rewrite(Uri request, Uri authority, Uri backchannel) =>
        request.Scheme == authority.Scheme && request.Host == authority.Host && request.Port == authority.Port
        ? new Uri(backchannel.GetLeftPart(UriPartial.Authority) + request.PathAndQuery) : request;
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.RequestUri is not null) {
            var rewritten = Rewrite(request.RequestUri, authority, backchannel);
            if (rewritten != request.RequestUri && !string.IsNullOrEmpty(bridgeToken)) {
                if (!backchannel.IsLoopback) throw new InvalidOperationException("Local bridge credentials require a loopback backchannel.");
                request.Headers.Add("x-flarestack-bridge", bridgeToken);
            }
            if (rewritten != request.RequestUri) { request.Headers.Add("x-flarestack-protocol", Flarestack.Internal.Protocol.Version); request.Headers.Add("x-flarestack-release", Flarestack.Internal.Protocol.Release); }
            request.RequestUri = rewritten;
        }
        var response = await base.SendAsync(request, cancellationToken);
        if (request.Headers.Contains("x-flarestack-protocol")) Flarestack.Internal.Protocol.Ensure(response, "Flarestack.Authentication");
        return response;
    }
}
public sealed class AccountEndpointOptions { public string DefaultReturnPath { get; set; } = "/"; }

public static class FlarestackAuthentication
{
    public static bool IsLocalReturnUrl(string? url) => !string.IsNullOrEmpty(url) && url[0] == '/' && (url.Length == 1 || url[1] is not ('/' or '\\')) && !url.Any(char.IsControl) && !url.Contains('\\');
    public static IServiceCollection AddFlarestackAuthentication(this IServiceCollection services, IConfiguration config)
    {
        services.AddOptions<OpenIdConnectOptions>(OpenIdConnectDefaults.AuthenticationScheme).PostConfigure<IHostEnvironment>((options, environment) => {
            if (!environment.IsDevelopment() && !options.RequireHttpsMetadata) throw new InvalidOperationException("HTTP authority is permitted only in Development.");
        });
        var authority = new Uri(config["Flarestack:Authentication:Authority"] ?? throw new InvalidOperationException("Authentication Authority is required."));
        var clientId = config["Flarestack:Authentication:ClientId"] ?? throw new InvalidOperationException("Authentication ClientId is required.");
        var local = authority.IsLoopback;
        if (authority.Scheme != "https" && !(local && authority.Scheme == "http")) throw new InvalidOperationException("HTTP authority is permitted only for loopback Development.");
        services.AddAuthentication(options => {
            options.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
            options.DefaultChallengeScheme = OpenIdConnectDefaults.AuthenticationScheme;
        }).AddCookie(options => {
            options.Cookie.Name = "Flarestack.Session." + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(clientId)))[..16];
            options.AccessDeniedPath = "/account/access-denied";
            options.Cookie.HttpOnly = true;
            options.Cookie.SameSite = SameSiteMode.Lax;
            options.Cookie.SecurePolicy = local ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
            options.ExpireTimeSpan = TimeSpan.FromHours(8);
            options.SlidingExpiration = true;
            options.Events.OnValidatePrincipal = async context => {
                var session = await context.HttpContext.RequestServices.GetRequiredService<AccountClient>().ValidateAsync(context.Principal!, context.HttpContext.RequestAborted);
                if (session is null) { context.RejectPrincipal(); await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme); return; }
                var identity = (ClaimsIdentity)context.Principal!.Identity!;
                foreach (var (type, value) in new[] { ("name", session.Name), ("email", session.Email), (ClaimTypes.Email, session.Email) }) {
                    if (identity.FindFirst(type)?.Value == value) continue;
                    foreach (var claim in identity.FindAll(type).ToArray()) identity.RemoveClaim(claim);
                    identity.AddClaim(new(type, value)); context.ShouldRenew = true;
                }
                if (!session.Roles.Order().SequenceEqual(identity.FindAll("role").Select(c => c.Value).Order())) {
                    foreach (var claim in identity.FindAll("role").ToArray()) identity.RemoveClaim(claim);
                    foreach (var role in session.Roles) identity.AddClaim(new("role", role));
                    context.ShouldRenew = true;
                }
            };
        }).AddOpenIdConnect(options => {
            options.Authority = authority.ToString().TrimEnd('/');
            options.ClientId = clientId;
            options.ResponseType = "code";
            options.UsePkce = true;
            options.SaveTokens = false;
            options.GetClaimsFromUserInfoEndpoint = true;
            options.RequireHttpsMetadata = !local;
            options.MapInboundClaims = false;
            options.Scope.Clear();
            foreach (var scope in new[] { "openid", "profile", "email" }) options.Scope.Add(scope);
            options.TokenValidationParameters.NameClaimType = "name";
            options.TokenValidationParameters.RoleClaimType = "role";
            options.ClaimActions.MapUniqueJsonKey(ClaimTypes.NameIdentifier, "sub");
            options.ClaimActions.MapUniqueJsonKey(ClaimTypes.Email, "email");
            options.ClaimActions.MapUniqueJsonKey("email", "email");
            options.ClaimActions.MapUniqueJsonKey("name", "name");
            options.Events.OnTokenValidated = context => {
                var identity = (ClaimsIdentity)context.Principal!.Identity!;
                if (identity.FindFirst("sub") is { } sub && !identity.HasClaim(c => c.Type == ClaimTypes.NameIdentifier)) identity.AddClaim(new(ClaimTypes.NameIdentifier, sub.Value));
                return Task.CompletedTask;
            };
            options.Events.OnRemoteFailure = async context => {
                context.HandleResponse();
                context.Response.StatusCode = 503;
                context.Response.ContentType = "text/html; charset=utf-8";
                await context.Response.WriteAsync("<!doctype html><title>Sign-in unavailable</title><h1>Sign-in could not be completed</h1><p>Please retry in a moment.</p><a href='/account/login'>Try again</a>");
            };
            options.Events.OnRedirectToIdentityProviderForSignOut = context => {
                context.ProtocolMessage.ClientId = clientId;
                return Task.CompletedTask;
            };
            if (config["Flarestack:Authentication:BackchannelBaseAddress"] is { Length: > 0 } backchannel)
                options.BackchannelHttpHandler = new AuthorityBackchannelHandler(authority, new Uri(backchannel), config["Flarestack:LocalBridgeToken"]);
            // Local HTTP uses query response mode so SameSite=Lax correlation cookies survive.
            if (local) {
                options.ResponseMode = "query";
                options.CorrelationCookie.SameSite = SameSiteMode.Lax;
                options.CorrelationCookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
                options.NonceCookie.SameSite = SameSiteMode.Lax;
                options.NonceCookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
            }
        });
        var bridge = new Uri(config["Flarestack:Authentication:BackchannelBaseAddress"] ?? "http://auth.internal");
        var bridgeToken = config["Flarestack:LocalBridgeToken"];
        if (!string.IsNullOrEmpty(bridgeToken) && !bridge.IsLoopback) throw new InvalidOperationException("Local bridge credentials require a loopback address.");
        services.AddHttpClient<AccountClient>(client => {
            Flarestack.Internal.Protocol.Configure(client);
            client.BaseAddress = bridge; client.Timeout = TimeSpan.FromSeconds(10);
            if (!string.IsNullOrEmpty(bridgeToken)) client.DefaultRequestHeaders.Add("x-flarestack-bridge", bridgeToken);
        });
        services.AddHttpContextAccessor();
        services.AddScoped<ICurrentUser, CurrentUser>();
        services.AddScoped<IUserAdministration, UserAdministration>();
        services.AddScoped<AuthenticationStateProvider, FlarestackAuthenticationStateProvider>();
        services.AddAuthorization(options => options.AddPolicy(FlarestackPolicies.Administration, policy => policy.RequireAuthenticatedUser().RequireRole("admin")));
        services.AddCascadingAuthenticationState();
        return services;
    }
    public static IEndpointRouteBuilder MapFlarestackAccountEndpoints(this IEndpointRouteBuilder endpoints, Action<AccountEndpointOptions>? configure = null)
    {
        var options = new AccountEndpointOptions(); configure?.Invoke(options);
        var defaultReturnUrl = options.DefaultReturnPath;
        if (!IsLocalReturnUrl(defaultReturnUrl)) throw new ArgumentException("Default return URL must be local.", nameof(defaultReturnUrl));
        endpoints.MapGet("/account/login", (string? returnUrl) => Results.Challenge(new AuthenticationProperties { RedirectUri = IsLocalReturnUrl(returnUrl) ? returnUrl : defaultReturnUrl }, [OpenIdConnectDefaults.AuthenticationScheme]));
        endpoints.MapPost("/account/logout", async (HttpContext context, Microsoft.AspNetCore.Antiforgery.IAntiforgery antiforgery) => {
            await antiforgery.ValidateRequestAsync(context);
            await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            await context.SignOutAsync(OpenIdConnectDefaults.AuthenticationScheme, new AuthenticationProperties { RedirectUri = "/" });
        }).RequireAuthorization();
        endpoints.MapGet("/account/access-denied", () => Results.Content("<!doctype html><title>Access denied</title><h1>Access denied</h1><p>Your account does not have permission to view this page.</p><a href='/account/settings'>Account settings</a>", "text/html", statusCode: 403));
        return endpoints;
    }
}

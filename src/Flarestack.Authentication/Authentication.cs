using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
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
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.RequestUri is not null) {
            var rewritten = Rewrite(request.RequestUri, authority, backchannel);
            if (rewritten != request.RequestUri && !string.IsNullOrEmpty(bridgeToken)) {
                if (!backchannel.IsLoopback) throw new InvalidOperationException("Local bridge credentials require a loopback backchannel.");
                request.Headers.Add("x-flarestack-bridge", bridgeToken);
            }
            request.RequestUri = rewritten;
        }
        return base.SendAsync(request, cancellationToken);
    }
}
public static class FlarestackAuthentication
{
    public static bool IsLocalReturnUrl(string? url) => !string.IsNullOrEmpty(url) && url[0] == '/' && (url.Length == 1 || url[1] is not ('/' or '\\')) && !url.Any(char.IsControl) && !url.Contains('\\');
    public static IServiceCollection AddFlarestackAuthentication(this IServiceCollection services, IConfiguration config, IHostEnvironment environment)
    {
        var authority = new Uri(config["Flarestack:Authentication:Authority"] ?? throw new InvalidOperationException("Authentication Authority is required."));
        var clientId = config["Flarestack:Authentication:ClientId"] ?? throw new InvalidOperationException("Authentication ClientId is required.");
        var local = environment.IsDevelopment() && authority.IsLoopback;
        if (authority.Scheme != "https" && !(local && authority.Scheme == "http")) throw new InvalidOperationException("HTTP authority is permitted only for loopback Development.");
        services.AddAuthentication(options => {
            options.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
            options.DefaultChallengeScheme = OpenIdConnectDefaults.AuthenticationScheme;
        }).AddCookie(options => {
            options.Cookie.Name = "Flarestack.Session";
            options.Cookie.HttpOnly = true;
            options.Cookie.SameSite = SameSiteMode.Lax;
            options.Cookie.SecurePolicy = local ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
            options.ExpireTimeSpan = TimeSpan.FromHours(8);
            options.SlidingExpiration = true;
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
            options.ClaimActions.MapUniqueJsonKey(ClaimTypes.NameIdentifier, "sub");
            options.ClaimActions.MapUniqueJsonKey(ClaimTypes.Email, "email");
            options.ClaimActions.MapUniqueJsonKey("email", "email");
            options.ClaimActions.MapUniqueJsonKey("name", "name");
            options.Events.OnTokenValidated = context => {
                var identity = (ClaimsIdentity)context.Principal!.Identity!;
                if (identity.FindFirst("sub") is { } sub && !identity.HasClaim(c => c.Type == ClaimTypes.NameIdentifier)) identity.AddClaim(new(ClaimTypes.NameIdentifier, sub.Value));
                return Task.CompletedTask;
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
        services.AddAuthorization();
        services.AddCascadingAuthenticationState();
        return services;
    }
    public static IEndpointRouteBuilder MapFlarestackAccountEndpoints(this IEndpointRouteBuilder endpoints, string defaultReturnUrl = "/")
    {
        if (!IsLocalReturnUrl(defaultReturnUrl)) throw new ArgumentException("Default return URL must be local.", nameof(defaultReturnUrl));
        endpoints.MapGet("/account/login", (string? returnUrl) => Results.Challenge(new AuthenticationProperties { RedirectUri = IsLocalReturnUrl(returnUrl) ? returnUrl : defaultReturnUrl }, [OpenIdConnectDefaults.AuthenticationScheme]));
        endpoints.MapPost("/account/logout", async (HttpContext context, Microsoft.AspNetCore.Antiforgery.IAntiforgery antiforgery) => {
            await antiforgery.ValidateRequestAsync(context);
            await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            await context.SignOutAsync(OpenIdConnectDefaults.AuthenticationScheme, new AuthenticationProperties { RedirectUri = "/" });
        }).RequireAuthorization();
        endpoints.MapGet("/account/access-denied", () => Results.StatusCode(403));
        return endpoints;
    }
}

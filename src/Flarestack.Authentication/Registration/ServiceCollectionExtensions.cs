using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Flarestack.Authentication.Administration;
using Flarestack.Authentication.Configuration;
using Flarestack.Authentication.Sessions;
using Flarestack.Authentication.Transport;
using Flarestack.Authentication.Users;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using AuthenticationOptions = Flarestack.Authentication.Configuration.AuthenticationOptions;

namespace Flarestack.Authentication.Registration;

/// <summary>Registers Flarestack authentication and maps account endpoints.</summary>
public static partial class FlarestackAuthentication
{
    /// <summary>Registers cookie, OpenID Connect, live session validation, and user administration services.</summary>
    public static IServiceCollection AddFlarestackAuthentication(
        this IServiceCollection services,
        IConfiguration config)
    {
        var authority = new Uri(config["Flarestack:Authentication:Authority"]
            ?? throw new InvalidOperationException("Authentication Authority is required."));
        var clientId = config["Flarestack:Authentication:ClientId"]
            ?? throw new InvalidOperationException("Authentication ClientId is required.");
        if (authority.Scheme != "https" && !(authority.IsLoopback && authority.Scheme == "http"))
        {
            throw new InvalidOperationException("HTTP authority is permitted only for loopback Development.");
        }

        var settings = new AuthenticationOptions
        {
            Authority = authority.ToString(),
            ClientId = clientId,
            BackchannelBaseAddress = config["Flarestack:Authentication:BackchannelBaseAddress"]
        };
        var bridge = new Uri(settings.BackchannelBaseAddress ?? "http://auth.internal");
        var bridgeToken = config["Flarestack:LocalBridgeToken"];
        if (!string.IsNullOrEmpty(bridgeToken) && !bridge.IsLoopback)
        {
            throw new InvalidOperationException("Local bridge credentials require a loopback address.");
        }

        return AddAuthenticationServices(services, _ => settings, bridgeToken);
    }

    /// <summary>Binds authentication settings, applies caller overrides, and validates final options at startup.</summary>
    public static IServiceCollection AddFlarestackAuthentication(
        this IServiceCollection services,
        IConfiguration config,
        Action<AuthenticationOptions> configure)
    {
        ArgumentNullException.ThrowIfNull(configure);
        var bridgeToken = config["Flarestack:LocalBridgeToken"];
        services.AddOptions<AuthenticationOptions>()
            .Bind(config.GetSection(AuthenticationOptions.SectionName))
            .Configure(configure)
            .ValidateOnStart();
        services.AddSingleton<IValidateOptions<AuthenticationOptions>>(provider =>
            new AuthenticationOptionsValidator(provider.GetRequiredService<IHostEnvironment>(), bridgeToken));

        return AddAuthenticationServices(
            services,
            provider => provider.GetRequiredService<IOptions<AuthenticationOptions>>().Value,
            bridgeToken);
    }

    private static IServiceCollection AddAuthenticationServices(
        IServiceCollection services,
        Func<IServiceProvider, AuthenticationOptions> getSettings,
        string? bridgeToken)
    {
        services.AddOptions<OpenIdConnectOptions>(OpenIdConnectDefaults.AuthenticationScheme)
            .PostConfigure<IHostEnvironment>((options, environment) =>
            {
                if (!environment.IsDevelopment() && !options.RequireHttpsMetadata)
                {
                    throw new InvalidOperationException("HTTP authority is permitted only in Development.");
                }
            });

        services.AddAuthentication(options =>
            {
                options.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
                options.DefaultChallengeScheme = OpenIdConnectDefaults.AuthenticationScheme;
            })
            .AddCookie()
            .AddOpenIdConnect();

        services.AddOptions<CookieAuthenticationOptions>(CookieAuthenticationDefaults.AuthenticationScheme)
            .Configure<IServiceProvider>((options, provider) =>
            {
                var settings = getSettings(provider);
                var clientId = settings.ClientId;
                var isLoopbackAuthority = new Uri(settings.Authority).IsLoopback;
                options.Cookie.Name = "Flarestack.Session."
                    + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(clientId)))[..16];
                options.AccessDeniedPath = "/account/access-denied";
                options.Cookie.HttpOnly = true;
                options.Cookie.SameSite = SameSiteMode.Lax;
                options.Cookie.SecurePolicy = isLoopbackAuthority
                    ? CookieSecurePolicy.SameAsRequest
                    : CookieSecurePolicy.Always;
                options.ExpireTimeSpan = TimeSpan.FromHours(8);
                options.SlidingExpiration = true;
                options.Events.OnValidatePrincipal = CookieSessionValidation.ValidatePrincipalAsync;
            });
        services.AddOptions<OpenIdConnectOptions>(OpenIdConnectDefaults.AuthenticationScheme)
            .Configure<IServiceProvider>((options, provider) =>
            {
                var settings = getSettings(provider);
                var authority = new Uri(settings.Authority);
                var clientId = settings.ClientId;
                var isLoopbackAuthority = authority.IsLoopback;
                options.Authority = authority.ToString().TrimEnd('/');
                options.ClientId = clientId;
                options.ResponseType = "code";
                options.UsePkce = true;
                options.SaveTokens = false;
                options.GetClaimsFromUserInfoEndpoint = true;
                options.RequireHttpsMetadata = !isLoopbackAuthority;
                options.MapInboundClaims = false;
                options.Scope.Clear();
                foreach (var scope in new[] { "openid", "profile", "email" })
                {
                    options.Scope.Add(scope);
                }

                options.TokenValidationParameters.NameClaimType = "name";
                options.TokenValidationParameters.RoleClaimType = "role";
                options.ClaimActions.MapUniqueJsonKey(ClaimTypes.NameIdentifier, "sub");
                options.ClaimActions.MapUniqueJsonKey(ClaimTypes.Email, "email");
                options.ClaimActions.MapUniqueJsonKey("email", "email");
                options.ClaimActions.MapUniqueJsonKey("name", "name");
                options.Events.OnTokenValidated = context =>
                {
                    var identity = (ClaimsIdentity)context.Principal!.Identity!;
                    if (identity.FindFirst("sub") is { } sub && !identity.HasClaim(c => c.Type == ClaimTypes.NameIdentifier))
                    {
                        identity.AddClaim(new(ClaimTypes.NameIdentifier, sub.Value));
                    }
                    return Task.CompletedTask;
                };
                options.Events.OnRemoteFailure = async context =>
                {
                    context.HandleResponse();
                    context.Response.StatusCode = 503;
                    context.Response.ContentType = "text/html; charset=utf-8";
                    await context.Response.WriteAsync(
                        "<!doctype html><title>Sign-in unavailable</title><h1>Sign-in could not be completed</h1><p>Please retry in a moment.</p><a href='/account/login'>Try again</a>");
                };
                options.Events.OnRedirectToIdentityProviderForSignOut = context =>
                {
                    context.ProtocolMessage.ClientId = clientId;
                    return Task.CompletedTask;
                };
                if (settings.BackchannelBaseAddress is { Length: > 0 } backchannel)
                {
                    options.BackchannelHttpHandler = new AuthorityBackchannelHandler(
                        authority,
                        new Uri(backchannel),
                        bridgeToken);
                }

                // Local HTTP uses query response mode so SameSite=Lax correlation cookies survive.
                if (isLoopbackAuthority)
                {
                    options.ResponseMode = "query";
                    options.CorrelationCookie.SameSite = SameSiteMode.Lax;
                    options.CorrelationCookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
                    options.NonceCookie.SameSite = SameSiteMode.Lax;
                    options.NonceCookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
                }
            });

        services.AddHttpClient<AccountClient>((provider, client) =>
        {
            var settings = getSettings(provider);
            Internal.Protocol.Configure(client);
            client.BaseAddress = new Uri(settings.BackchannelBaseAddress ?? "http://auth.internal");
            client.Timeout = TimeSpan.FromSeconds(10);
            if (!string.IsNullOrEmpty(bridgeToken))
            {
                client.DefaultRequestHeaders.Add("x-flarestack-bridge", bridgeToken);
            }
        });

        services.AddHttpContextAccessor();
        services.AddScoped<ICurrentUser, CurrentUser>();
        services.AddScoped<IUserAdministration, UserAdministration>();
        services.AddScoped<AuthenticationStateProvider, FlarestackAuthenticationStateProvider>();
        services.AddAuthorization(options => options.AddPolicy(
            FlarestackPolicies.Administration,
            policy => policy.RequireAuthenticatedUser().RequireRole("admin")));
        services.AddCascadingAuthenticationState();

        return services;
    }
}

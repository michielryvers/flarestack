using Flarestack.Authentication.Configuration;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Flarestack.Authentication.Endpoints;

public static partial class FlarestackAuthentication
{
    /// <summary>Checks whether a return URL is a local absolute path without control characters or backslashes.</summary>
    public static bool IsLocalReturnUrl(string? url) =>
        !string.IsNullOrEmpty(url)
        && url[0] == '/'
        && (url.Length == 1 || url[1] is not ('/' or '\\'))
        && !url.Any(char.IsControl)
        && !url.Contains('\\');

    /// <summary>Maps login, antiforgery-protected logout, and access-denied endpoints.</summary>
    public static IEndpointRouteBuilder MapFlarestackAccountEndpoints(
        this IEndpointRouteBuilder endpoints,
        Action<AccountEndpointOptions>? configure = null)
    {
        var options = new AccountEndpointOptions();
        configure?.Invoke(options);
        var defaultReturnUrl = options.DefaultReturnPath;
        if (!IsLocalReturnUrl(defaultReturnUrl))
        {
            throw new ArgumentException("Default return URL must be local.", nameof(defaultReturnUrl));
        }

        endpoints.MapGet("/account/login", (string? returnUrl) => Results.Challenge(
            new AuthenticationProperties
            {
                RedirectUri = IsLocalReturnUrl(returnUrl) ? returnUrl : defaultReturnUrl
            },
            [OpenIdConnectDefaults.AuthenticationScheme]));

        endpoints.MapPost("/account/logout", async (HttpContext context, IAntiforgery antiforgery) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            await context.SignOutAsync(
                OpenIdConnectDefaults.AuthenticationScheme,
                new AuthenticationProperties { RedirectUri = "/" });
        }).RequireAuthorization();

        endpoints.MapGet("/account/access-denied", () => Results.Content(
            "<!doctype html><title>Access denied</title><h1>Access denied</h1><p>Your account does not have permission to view this page.</p><a href='/account/settings'>Account settings</a>",
            "text/html",
            statusCode: 403));

        return endpoints;
    }
}

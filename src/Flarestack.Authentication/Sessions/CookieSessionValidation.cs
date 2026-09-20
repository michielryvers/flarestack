using System.Security.Claims;
using Flarestack.Authentication.Transport;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.Extensions.DependencyInjection;

namespace Flarestack.Authentication.Sessions;

internal static class CookieSessionValidation
{
    internal static async Task ValidatePrincipalAsync(CookieValidatePrincipalContext context)
    {
        var session = await context.HttpContext.RequestServices.GetRequiredService<AccountClient>().ValidateAsync(context.Principal!, context.HttpContext.RequestAborted);
        if (session is null)
        {
            context.RejectPrincipal();
            await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return;
        }

        var identity = (ClaimsIdentity)context.Principal!.Identity!;
        foreach (var (type, value) in new[] { ("name", session.Name), ("email", session.Email), (ClaimTypes.Email, session.Email) })
        {
            if (identity.FindFirst(type)?.Value == value)
            {
                continue;
            }
            foreach (var claim in identity.FindAll(type).ToArray())
            {
                identity.RemoveClaim(claim);
            }
            identity.AddClaim(new(type, value));
            context.ShouldRenew = true;
        }
        if (!session.Roles.Order().SequenceEqual(identity.FindAll("role").Select(c => c.Value).Order()))
        {
            foreach (var claim in identity.FindAll("role").ToArray())
            {
                identity.RemoveClaim(claim);
            }
            foreach (var role in session.Roles)
            {
                identity.AddClaim(new("role", role));
            }
            context.ShouldRenew = true;
        }
    }
}

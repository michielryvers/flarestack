using System.Security.Claims;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Todo.Client;

namespace Todo.Web;

public static class TodoApi
{
    public static void MapTodoApi(this WebApplication app)
    {
        // Explicitly challenge the cookie scheme: API callers receive 401, never an OIDC redirect.
        var api = app.MapGroup("/api").RequireAuthorization(new AuthorizeAttribute
        {
            AuthenticationSchemes = CookieAuthenticationDefaults.AuthenticationScheme
        });
        api.AddEndpointFilter(async (context, next) =>
        {
            var http = context.HttpContext;
            http.Response.Headers.CacheControl = "no-store";
            try
            {
                if (!HttpMethods.IsGet(http.Request.Method))
                    await http.RequestServices.GetRequiredService<IAntiforgery>().ValidateRequestAsync(http);
                return await next(context);
            }
            catch (AntiforgeryValidationException) { return Results.BadRequest(new { error = "Invalid request token." }); }
            catch (UnauthorizedAccessException) { return Results.Unauthorized(); }
        });
        api.MapGet("/session", (HttpContext http, IAntiforgery antiforgery) =>
            new BrowserSession(http.User.FindFirstValue("sub")!, http.User.Identity?.Name ?? "",
                http.User.FindFirstValue("email") ?? "", http.User.FindAll("role").Select(c => c.Value).ToArray(),
                antiforgery.GetAndStoreTokens(http).RequestToken!));
        api.MapGet("/todos", async (TodoRepository repository, CancellationToken ct) =>
            await repository.ListAsync(ct));
        api.MapPost("/todos", async (CreateTodo input, TodoRepository repository, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(input.Title) || input.Title.Trim().Length > 200)
                return Results.BadRequest(new { error = "Use a title between 1 and 200 characters." });
            await repository.AddAsync(input.Title, ct);
            return Results.NoContent();
        });
        api.MapPatch("/todos/{id}", async (string id, CompleteTodo input, TodoRepository repository, CancellationToken ct) =>
            await repository.SetCompleteAsync(id, input.IsComplete, ct) == 0 ? Results.NotFound() : Results.NoContent());
        api.MapDelete("/todos/{id}", async (string id, TodoRepository repository, CancellationToken ct) =>
            await repository.DeleteAsync(id, ct) == 0 ? Results.NotFound() : Results.NoContent());
        api.MapPost("/client-logs", (BrowserLog[] entries, ILoggerFactory loggerFactory) =>
        {
            if (entries.Length > 32 || entries.Any(e => e.Level is < 2 or > 5)) return Results.BadRequest();
            // Never accept formatted messages, exception text, claims or request contents from the browser.
            var logger = loggerFactory.CreateLogger("Todo.Client");
            foreach (var entry in entries)
                logger.Log((LogLevel)entry.Level, new EventId(entry.EventId),
                    "Browser event {BrowserEventId} (WebAssembly)", entry.EventId);
            return Results.NoContent();
        });
    }
}

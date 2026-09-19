using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole(options => options.IncludeScopes = true);
builder.Services.AddHttpClient("d1", client =>
{
    client.BaseAddress = new Uri("http://d1.internal");
    client.Timeout = TimeSpan.FromSeconds(10);
});
var app = builder.Build();
app.UseWebSockets();
app.MapGet("/", () => Results.Json(new { message = "Hello from .NET 10", runtime = Environment.Version.ToString() }));
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
// Fixed SQL only. Public callers cannot supply SQL or parameters.
app.MapGet("/probe/d1", async (IHttpClientFactory clients, CancellationToken ct) =>
{
    using var content = new StringContent(JsonSerializer.Serialize(
        new { protocolVersion = 1, operation = "query", sql = "SELECT 1 AS value", parameters = Array.Empty<object>() }), Encoding.UTF8, "application/json");
    using var response = await clients.CreateClient("d1").PostAsync("/v1/commands", content, ct);
    response.EnsureSuccessStatusCode();
    return Results.Content(await response.Content.ReadAsStringAsync(ct), "application/json");
});
app.Map("/ws", async context =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = 400;
        return;
    }
    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    var buffer = new byte[4096];
    while (socket.State == WebSocketState.Open)
    {
        var result = await socket.ReceiveAsync(buffer.AsMemory(), context.RequestAborted);
        if (result.MessageType == WebSocketMessageType.Close)
        {
            await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closed", context.RequestAborted);
            break;
        }
        await socket.SendAsync(buffer.AsMemory(0, result.Count), result.MessageType, result.EndOfMessage, context.RequestAborted);
    }
});
app.Run();

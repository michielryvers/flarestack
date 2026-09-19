using Flarestack.Authentication;
using Flarestack.D1;
using Microsoft.AspNetCore.HttpOverrides;
using Todo.Web;
using Todo.Web.Components;

var builder = WebApplication.CreateBuilder(args);
builder.AddServiceDefaults();
builder.Services.AddRazorComponents().AddInteractiveServerComponents();
builder.Services.AddFlarestackD1(builder.Configuration);
builder.Services.AddFlarestackAuthentication(builder.Configuration, builder.Environment);
builder.Services.AddScoped<TodoRepository>();
builder.Services.Configure<ForwardedHeadersOptions>(options => {
    options.ForwardedHeaders = ForwardedHeaders.XForwardedHost | ForwardedHeaders.XForwardedProto;
    options.ForwardLimit = 1;
    // The only container ingress is the Worker, which replaces these headers.
    options.KnownIPNetworks.Clear(); options.KnownProxies.Clear();
    options.AllowedHosts.Add(new Uri(builder.Configuration["Flarestack:Authentication:Authority"]!).Host);
});
var app = builder.Build();
app.UseForwardedHeaders();
app.UseAuthentication();
app.UseAuthorization();
app.UseAntiforgery();
app.MapStaticAssets();
app.MapFlarestackAccountEndpoints();
app.MapRazorComponents<App>().AddInteractiveServerRenderMode();
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.Run();

using Flarestack.Authentication.Endpoints;
using Flarestack.Authentication.Registration;
using Flarestack.D1;
using Flarestack.Email;
using Microsoft.AspNetCore.HttpOverrides;
using Todo.Client;
using Todo.ServiceDefaults;
using Todo.Web;
using Todo.Web.Components;

var builder = WebApplication.CreateBuilder(args);
builder.AddServiceDefaults();
builder.Services.AddRazorComponents().AddInteractiveServerComponents().AddInteractiveWebAssemblyComponents();
// Use the options overloads to validate configuration at startup.
builder.Services.AddFlarestackD1(builder.Configuration, static _ => { });
builder.Services.AddFlarestackEmail(builder.Configuration, static _ => { });
builder.Services.AddFlarestackAuthentication(builder.Configuration, static _ => { });
builder.Services.PostConfigure<Microsoft.AspNetCore.Authentication.Cookies.CookieAuthenticationOptions>("Cookies", options =>
{
    options.Events.OnRedirectToLogin = context =>
    {
        if (context.Request.Path.StartsWithSegments("/api")) context.Response.StatusCode = 401;
        else context.Response.Redirect(context.RedirectUri);
        return Task.CompletedTask;
    };
    options.Events.OnRedirectToAccessDenied = context =>
    {
        if (context.Request.Path.StartsWithSegments("/api")) context.Response.StatusCode = 403;
        else context.Response.Redirect(context.RedirectUri);
        return Task.CompletedTask;
    };
});
builder.Services.AddScoped<TodoRepository>();
builder.Services.AddScoped<ITodoService>(services => services.GetRequiredService<TodoRepository>());
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
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
// Public runtime/CSS assets need no session lookup. WASM downloads many in parallel.
// Protected pages, API requests and Blazor connections still validate their cookies.
app.MapStaticAssets().ShortCircuit();
app.MapFlarestackAccountEndpoints(options => options.DefaultReturnPath = "/todos");
app.MapTodoApi();
app.MapRazorComponents<App>().AddInteractiveServerRenderMode()
    .AddInteractiveWebAssemblyRenderMode().AddAdditionalAssemblies(typeof(ITodoService).Assembly);
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.Run();

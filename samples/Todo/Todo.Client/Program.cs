using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using Todo.Client;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.Services.AddSingleton(new HttpClient { BaseAddress = new Uri(builder.HostEnvironment.BaseAddress), Timeout = TimeSpan.FromSeconds(10) });
builder.Services.AddAuthorizationCore();
builder.Services.AddCascadingAuthenticationState();
builder.Services.AddSingleton<BrowserAuthenticationState>();
builder.Services.AddSingleton<AuthenticationStateProvider>(services => services.GetRequiredService<BrowserAuthenticationState>());
builder.Services.AddScoped<ITodoService, HttpTodoService>();
builder.Logging.ClearProviders();
builder.Services.AddSingleton<ILoggerProvider, BrowserLoggerProvider>();
var host = builder.Build();
host.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Todo.Client")
    .LogInformation(new EventId(1000), "WebAssembly started");
await host.RunAsync();

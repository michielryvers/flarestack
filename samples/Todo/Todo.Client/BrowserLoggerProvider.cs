using System.Net.Http.Json;

namespace Todo.Client;

// The backend's OTLP exporter owns delivery to Aspire. No collector credentials in the browser.
// Deliberately send only severity/event IDs: formatted logs and exception text can contain secrets.
public sealed class BrowserLoggerProvider(HttpClient http, BrowserAuthenticationState session) : ILoggerProvider
{
    private readonly Queue<BrowserLog> _pending = new();
    private readonly CancellationTokenSource _stop = new();
    private Task? _pump;
    public ILogger CreateLogger(string categoryName) => new BrowserLogger(this);
    private void Enqueue(LogLevel level, EventId eventId)
    {
        if (_pending.Count < 32) _pending.Enqueue(new((int)level, eventId.Id));
        _pump ??= ExportAsync();
    }
    private async Task ExportAsync()
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(5));
        try
        {
            // Flush the first event immediately: a short visit may end before a batch timer fires.
            do
            {
                if (_pending.Count == 0) continue;
                var batch = _pending.ToArray(); _pending.Clear();
                try
                {
                    using var request = new HttpRequestMessage(HttpMethod.Post, "api/client-logs") { Content = JsonContent.Create(batch) };
                    request.Headers.Add("RequestVerificationToken", await session.GetRequestTokenAsync());
                    using var response = await http.SendAsync(request, _stop.Token);
                }
                catch (Exception error) when (error is HttpRequestException or OperationCanceledException or UnauthorizedAccessException)
                { /* Bounded, best-effort logging; never recursively log an export failure. */ }
            } while (await timer.WaitForNextTickAsync(_stop.Token));
        }
        catch (OperationCanceledException) { }
    }
    public void Dispose() { _stop.Cancel(); _stop.Dispose(); }
    private sealed class BrowserLogger(BrowserLoggerProvider owner) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel level) => level is >= LogLevel.Information and < LogLevel.None;
        public void Log<TState>(LogLevel level, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        { if (IsEnabled(level)) owner.Enqueue(level, eventId); }
    }
}

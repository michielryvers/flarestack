using System.Net;
using System.Net.Http.Json;

namespace Todo.Client;

public sealed class HttpTodoService(HttpClient http, BrowserAuthenticationState session) : ITodoService
{
    public async Task<IReadOnlyList<TodoItem>> ListAsync(CancellationToken ct = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "api/todos");
        using var response = await SendAsync(request, ct);
        return await response.Content.ReadFromJsonAsync<TodoItem[]>(ct) ?? [];
    }
    public Task<int> AddAsync(string title, CancellationToken ct = default) =>
        MutateAsync(HttpMethod.Post, "api/todos", new CreateTodo(title), ct);
    public Task<int> SetCompleteAsync(string id, bool complete, CancellationToken ct = default) =>
        MutateAsync(HttpMethod.Patch, $"api/todos/{Uri.EscapeDataString(id)}", new CompleteTodo(complete), ct);
    public Task<int> DeleteAsync(string id, CancellationToken ct = default) =>
        MutateAsync<object>(HttpMethod.Delete, $"api/todos/{Uri.EscapeDataString(id)}", null, ct);

    private async Task<int> MutateAsync<T>(HttpMethod method, string path, T? input, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(method, path);
        request.Headers.Add("RequestVerificationToken", await session.GetRequestTokenAsync());
        if (input is not null) request.Content = JsonContent.Create(input);
        using var response = await SendAsync(request, ct);
        return 1;
    }
    private async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var response = await http.SendAsync(request, ct);
        if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
        {
            response.Dispose(); session.Invalidate(); throw new UnauthorizedAccessException();
        }
        if (!response.IsSuccessStatusCode)
        {
            var status = response.StatusCode;
            response.Dispose();
            throw new HttpRequestException("Task request failed.", null, status);
        }
        return response;
    }
}

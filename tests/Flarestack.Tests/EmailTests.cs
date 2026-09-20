using Flarestack.Email;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Flarestack.Tests;

public class EmailTests
{
    private sealed class Handler : HttpMessageHandler
    {
        public int Requests;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        { Requests++; var response = new HttpResponseMessage(System.Net.HttpStatusCode.BadGateway); response.Headers.Add("x-flarestack-protocol", "2"); return Task.FromResult(response); }
    }
    [Fact]
    public async Task RejectsHeaderInjectionBeforeTransport()
    {
        var handler = new Handler();
        var sender = new EmailSender(new HttpClient(handler) { BaseAddress = new Uri("http://email.internal") }, NullLogger<EmailSender>.Instance);
        await Assert.ThrowsAsync<ArgumentException>(() => sender.SendAsync(new("user@example.com", "Hello\r\nBcc: attacker@example.com", "body")));
        Assert.Equal(0, handler.Requests);
    }
    [Fact]
    public async Task DoesNotRetryFailedSends()
    {
        var handler = new Handler();
        var sender = new EmailSender(new HttpClient(handler) { BaseAddress = new Uri("http://email.internal") }, NullLogger<EmailSender>.Instance);
        await Assert.ThrowsAsync<EmailDeliveryException>(() => sender.SendAsync(new("user@example.com", "Hello", "body")));
        Assert.Equal(1, handler.Requests);
    }
}

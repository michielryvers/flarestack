using System.Diagnostics;
using System.Net.Http.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Flarestack.Email;

public sealed record EmailMessage(string To, string Subject, string Text);
public interface IEmailSender
{
    Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default);
}
public sealed class EmailDeliveryException() : Exception("Email delivery failed. See the correlated email trace.");
public static class EmailRegistration
{
    public static IServiceCollection AddFlarestackEmail(this IServiceCollection services, IConfiguration configuration)
    {
        var address = new Uri(configuration["Flarestack:Email:BaseAddress"] ?? "http://email.internal");
        var token = configuration["Flarestack:LocalBridgeToken"];
        if (address.Scheme is not ("http" or "https") || (!string.IsNullOrEmpty(token) && !address.IsLoopback))
            throw new InvalidOperationException("Invalid email bridge configuration.");
        services.AddHttpClient<IEmailSender, EmailSender>(client => {
            client.BaseAddress = address; client.Timeout = TimeSpan.FromSeconds(30);
            if (!string.IsNullOrEmpty(token)) client.DefaultRequestHeaders.Add("x-flarestack-bridge", token);
        });
        return services;
    }
}
public sealed class EmailSender(HttpClient client, ILogger<EmailSender> logger) : IEmailSender
{
    public static readonly ActivitySource ActivitySource = new("Flarestack.Email");
    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(message);
        if (!System.Net.Mail.MailAddress.TryCreate(message.To, out var address) || address.Address != message.To ||
            string.IsNullOrWhiteSpace(message.Subject) || message.Subject.Length > 200 || message.Subject.Contains('\r') || message.Subject.Contains('\n') ||
            string.IsNullOrEmpty(message.Text) || System.Text.Encoding.UTF8.GetByteCount(message.Text) > 100_000)
            throw new ArgumentException("Invalid email message.", nameof(message));
        using var span = ActivitySource.StartActivity("email.send", ActivityKind.Client);
        try {
            using var response = await client.PostAsJsonAsync("/v1/email", message, cancellationToken);
            if (!response.IsSuccessStatusCode) throw new EmailDeliveryException();
            logger.LogInformation("Email accepted");
        } catch {
            span?.SetStatus(ActivityStatusCode.Error);
            logger.LogWarning("Email send failed");
            throw;
        }
    }
}

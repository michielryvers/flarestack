using System.Diagnostics;
using System.Net.Http.Json;
using System.Net.Mail;
using System.Text;
using Flarestack.Internal;
using Microsoft.Extensions.Logging;

namespace Flarestack.Email;

/// <summary>Submits validated messages to the private email binding.</summary>
public sealed class EmailSender(HttpClient client, ILogger<EmailSender> logger) : IFlarestackEmailSender
{
    private const int MaximumSubjectLength = 200;
    private const int MaximumTextBytes = 100_000;

    public static readonly ActivitySource ActivitySource = new("Flarestack.Email");

    /// <inheritdoc />
    public async Task<EmailSendResult> SendAsync(
        EmailMessage message,
        CancellationToken cancellationToken = default)
    {
        ValidateMessage(message);

        using var activity = ActivitySource.StartActivity("email.send", ActivityKind.Client);

        try
        {
            using var response = await client.PostAsJsonAsync("/v1/email", message, cancellationToken);
            Protocol.Ensure(response, "Flarestack.Email");

            if (!response.IsSuccessStatusCode)
            {
                throw new EmailDeliveryException();
            }

            logger.LogInformation("Email accepted");
            return new EmailSendResult(EmailDeliveryState.Accepted);
        }
        catch
        {
            activity?.SetStatus(ActivityStatusCode.Error);
            logger.LogWarning("Email send failed");
            throw;
        }
    }

    private static void ValidateMessage(EmailMessage message)
    {
        ArgumentNullException.ThrowIfNull(message);

        if (!MailAddress.TryCreate(message.To, out var address) || address.Address != message.To ||
            string.IsNullOrWhiteSpace(message.Subject) ||
            message.Subject.Length > MaximumSubjectLength ||
            message.Subject.Contains('\r') || message.Subject.Contains('\n') ||
            string.IsNullOrEmpty(message.Text) ||
            Encoding.UTF8.GetByteCount(message.Text) > MaximumTextBytes)
        {
            throw new ArgumentException("Invalid email message.", nameof(message));
        }
    }
}

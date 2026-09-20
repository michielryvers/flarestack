namespace Flarestack.Email;

/// <summary>Sends application email through the Flarestack email binding.</summary>
public interface IFlarestackEmailSender
{
    /// <summary>Submits a message without retrying a potentially accepted send.</summary>
    Task<EmailSendResult> SendAsync(EmailMessage message, CancellationToken cancellationToken = default);
}

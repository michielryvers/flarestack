namespace Flarestack.Email;

/// <summary>The transport outcome, with a provider identifier when available.</summary>
public sealed record EmailSendResult(EmailDeliveryState State, string? ProviderMessageId = null);

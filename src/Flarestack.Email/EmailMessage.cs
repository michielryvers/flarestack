namespace Flarestack.Email;

/// <summary>A plain-text email addressed to a single recipient.</summary>
public sealed record EmailMessage(string To, string Subject, string Text);

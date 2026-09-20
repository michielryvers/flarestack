namespace Flarestack.Email;

/// <summary>The email binding returned an unsuccessful response.</summary>
public sealed class EmailDeliveryException()
    : Exception("Email delivery failed. See the correlated email trace.");

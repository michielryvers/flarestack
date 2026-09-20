namespace Flarestack.Authentication.Administration;

/// <summary>A user returned by the administration service.</summary>
public sealed record AdminUser(string Id, string Email, string Name, string Role, bool Banned);

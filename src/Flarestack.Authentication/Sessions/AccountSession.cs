namespace Flarestack.Authentication.Sessions;

/// <summary>A live account session returned by the authentication service.</summary>
public sealed record AccountSession(string Id, string Email, string Name, string[] Roles);

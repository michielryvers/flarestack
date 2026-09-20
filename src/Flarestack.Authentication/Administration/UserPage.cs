namespace Flarestack.Authentication.Administration;

/// <summary>A page of users and the total number of matching users.</summary>
public sealed record UserPage(AdminUser[] Users, int Total);

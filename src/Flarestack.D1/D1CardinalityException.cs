namespace Flarestack.D1;

/// <summary>A query expected at most one row but returned multiple rows.</summary>
public sealed class D1CardinalityException() : Exception("Expected at most one D1 row.");

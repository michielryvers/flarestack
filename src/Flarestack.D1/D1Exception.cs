namespace Flarestack.D1;

/// <summary>A failure reported by the private D1 binding.</summary>
public sealed class D1Exception(string code, string operation, string correlationId)
    : Exception($"D1 {operation} failed ({code}, correlation {correlationId}).")
{
    public string Code { get; } = code;
    public string Operation { get; } = operation;
    public string CorrelationId { get; } = correlationId;
}

using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Flarestack.Internal;
using Microsoft.Extensions.Logging;

namespace Flarestack.D1;

/// <summary>Submits queries and commands to the private D1 binding without automatic retries.</summary>
public sealed class D1Database(HttpClient client, D1Options options, ILogger<D1Database> logger) : ID1Database
{
    private const long MaximumSafeInteger = 9_007_199_254_740_991;
    private const int MaximumSqlLength = 100_000;
    private const int MaximumParameterCount = 100;
    private const int MaximumTraceSqlLength = 16_384;

    public static readonly ActivitySource ActivitySource = new("Flarestack.D1");

    private static readonly JsonSerializerOptions RowSerializerOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        Converters = { new SqliteBooleanConverter() }
    };

    /// <summary>Converts a supported .NET value to the D1 wire representation.</summary>
    public static object? ConvertParameter(object? value) => value switch
    {
        null or string or byte or sbyte or short or ushort or int or uint => value,
        long number when number is >= -MaximumSafeInteger and <= MaximumSafeInteger => number,
        ulong number when number <= MaximumSafeInteger => number,
        float number when float.IsFinite(number) => number,
        double number when double.IsFinite(number) => number,
        bool boolean => boolean ? 1 : 0,
        Guid guid => guid.ToString("D"),
        DateTime date when date.Kind != DateTimeKind.Unspecified => date.ToUniversalTime()
            .ToString("O", CultureInfo.InvariantCulture),
        DateTimeOffset date => date.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture),
        byte[] bytes => new { type = "base64", value = Convert.ToBase64String(bytes) },
        _ => throw new ArgumentException(
            $"Unsupported D1 parameter: {value.GetType().Name}. Dates must have a timezone and integers must be JavaScript-safe.")
    };

    /// <inheritdoc />
    public async Task<IReadOnlyList<T>> QueryAsync<T>(
        string sql,
        IReadOnlyList<object?>? parameters = null,
        CancellationToken cancellationToken = default)
    {
        using var document = await SendAsync("query", CreateCommand(sql, parameters, "query"), cancellationToken);
        return document.RootElement.GetProperty("rows").Deserialize<List<T>>(RowSerializerOptions) ?? [];
    }

    /// <inheritdoc />
    public async Task<T?> QuerySingleOrDefaultAsync<T>(
        string sql,
        IReadOnlyList<object?>? parameters = null,
        CancellationToken cancellationToken = default)
    {
        var rows = await QueryAsync<T>(sql, parameters, cancellationToken);

        return rows.Count switch
        {
            0 => default,
            1 => rows[0],
            _ => throw new D1CardinalityException()
        };
    }

    /// <inheritdoc />
    public async Task<int> ExecuteAsync(
        string sql,
        IReadOnlyList<object?>? parameters = null,
        CancellationToken cancellationToken = default)
    {
        using var document = await SendAsync("execute", CreateCommand(sql, parameters, "execute"), cancellationToken);
        return document.RootElement.GetProperty("rowsAffected").GetInt32();
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<D1CommandResult>> BatchAsync(
        IReadOnlyList<D1Command> commands,
        CancellationToken cancellationToken = default)
    {
        if (commands.Count == 0 || commands.Count > options.MaxCommands)
        {
            throw new ArgumentException("Invalid D1 batch command count.");
        }

        using var document = await SendAsync("batch",
            new
            {
                commands = commands.Select(command => CreateCommand(
                    command.Sql,
                    command.Parameters,
                    command.Kind == D1CommandKind.Query ? "query" : "execute"))
            }, cancellationToken);

        return document.RootElement.GetProperty("results")
            .Deserialize<List<D1CommandResult>>(new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? [];
    }

    private static object CreateCommand(string sql, IReadOnlyList<object?>? parameters, string operation)
    {
        if (string.IsNullOrWhiteSpace(sql) || sql.Length > MaximumSqlLength)
        {
            throw new ArgumentException("D1 SQL must contain 1–100000 characters.");
        }

        if (parameters?.Count > MaximumParameterCount)
        {
            throw new ArgumentException("D1 supports at most 100 parameters per command.");
        }

        return new { operation, sql, parameters = parameters?.Select(ConvertParameter).ToArray() ?? [] };
    }

    private async Task<JsonDocument> SendAsync(
        string operation,
        object command,
        CancellationToken cancellationToken)
    {
        using var activity = ActivitySource.StartActivity($"D1 {operation}", ActivityKind.Client);
        activity?.SetTag("db.system.name", "sqlite").SetTag("db.operation.name", operation);

        var commandFields = JsonSerializer.SerializeToElement(command);
        SetSqlTraceTag(activity, operation, commandFields);

        var payload = commandFields.EnumerateObject()
            .ToDictionary(property => property.Name, property => (object?)property.Value);
        payload["protocolVersion"] = 2;
        payload["operation"] = operation;

        var requestBytes = JsonSerializer.SerializeToUtf8Bytes(payload);

        if (requestBytes.Length > options.MaxRequestBytes)
        {
            throw new ArgumentException("D1 request exceeds configured size limit.");
        }

        using var content = new ByteArrayContent(requestBytes);
        content.Headers.ContentType = new("application/json");

        using var response = await client.PostAsync("/v1/commands", content, cancellationToken);
        Protocol.Ensure(response, "Flarestack.D1");

        var responseStream = await response.Content.ReadAsStreamAsync(cancellationToken);
        var document = await JsonDocument.ParseAsync(responseStream, cancellationToken: cancellationToken);

        if (!response.IsSuccessStatusCode || !document.RootElement.GetProperty("ok").GetBoolean())
        {
            var correlationId = document.RootElement.GetProperty("correlationId").GetString() ?? "unknown";
            var code = document.RootElement.GetProperty("error").GetProperty("code").GetString() ?? "D1_FAILURE";
            document.Dispose();

            activity?.SetStatus(ActivityStatusCode.Error, code);
            logger.LogError("D1 {Operation} failed: {Code}, correlation {CorrelationId}", operation, code, correlationId);
            throw new D1Exception(code, operation, correlationId);
        }

        logger.LogInformation("D1 {Operation} completed", operation);
        return document;
    }

    private void SetSqlTraceTag(Activity? activity, string operation, JsonElement commandFields)
    {
        if (activity?.IsAllDataRequested == true && options.IncludeSqlInTraces)
        {
            // Capture statement text only. Bound parameter values never become span attributes.
            var sql = operation == "batch"
                ? string.Join(";\n", commandFields.GetProperty("commands").EnumerateArray()
                    .Select(command => command.GetProperty("sql").GetString()))
                : commandFields.GetProperty("sql").GetString()!;

            activity.SetTag("db.query.text", sql.Length <= MaximumTraceSqlLength
                ? sql
                : sql[..MaximumTraceSqlLength] + " /* truncated */");
        }
    }

    private sealed class SqliteBooleanConverter : JsonConverter<bool>
    {
        public override bool Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options) =>
            reader.TokenType == JsonTokenType.Number ? reader.GetInt32() != 0 : reader.GetBoolean();

        public override void Write(Utf8JsonWriter writer, bool value, JsonSerializerOptions options) =>
            writer.WriteBooleanValue(value);
    }
}

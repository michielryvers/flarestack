# D1 configuration

The options overload binds `Flarestack:D1`, applies the supplied callback, and validates the final options at host startup (or first options/client access):

```csharp
builder.Services.AddFlarestackD1(builder.Configuration, options =>
{
    options.TimeoutSeconds = 15;
    options.MaxCommands = 50;
});
```

Pass `_ => { }` to use bound configuration without callback overrides. Later `Configure<D1Options>` registrations and `PostConfigure<D1Options>` run before validation. The HTTP client and database receive the same validated options instance, including request size, batch command count, and SQL trace settings. These settings are captured through `IOptions<D1Options>`; configuration reload is not a live client reconfiguration mechanism.

| Property | Default | Validation |
| --- | --- | --- |
| `BaseAddress` | `http://d1.internal` | Absolute HTTP or HTTPS URI |
| `TimeoutSeconds` | `30` | 1–2,147,483 seconds |
| `MaxRequestBytes` | `1048576` | Positive serialized request byte limit |
| `MaxCommands` | `100` | Positive batch command count limit |
| `IncludeSqlInTraces` | `false` | Opt-in SQL text; bound parameter values are excluded |

`D1Options.SectionName` is `Flarestack:D1`. Existing public property names, including the integer `TimeoutSeconds`, remain unchanged. Unlike the newer Email options, D1 does not introduce a `TimeSpan` timeout property. The timeout ceiling matches the largest whole-second duration supported by `HttpClient`.

`Flarestack:LocalBridgeToken` stays outside public options and is captured at registration. When configured, validation requires the final D1 address to be loopback, including after `PostConfigure`. Validation errors identify the invalid setting without echoing addresses or credentials. Do not put secrets in SQL text when enabling SQL tracing.

The existing two-argument `AddFlarestackD1(configuration)` overload retains immediate registration-time validation and its original singleton options registration. Its original timeout behavior is also preserved: positive values beyond the HTTP client maximum are accepted during registration and rejected when the client is created. Existing direct `D1Database(HttpClient, D1Options, ILogger<D1Database>)` construction remains available. Use one registration overload per service collection; the three-argument overload is the opt-in options pipeline.

This change does not add retries or alter protocol headers, request payloads, W3C trace propagation, or D1 transport behavior.

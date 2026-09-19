# D1 application API

Register `AddFlarestackD1(configuration)` and inject `ID1Database` for
`QueryAsync<T>`, `QuerySingleOrDefaultAsync<T>`, `ExecuteAsync` and `BatchAsync`.
Pass values separately through `?1`, `?2`, … parameters. Numbered SQL files in
`migrations/` are applied by Alchemy; Better Auth owns its separate auth schema.

**D1 does not enforce per-user ownership for you.** Repositories should inject
`ICurrentUser` and resolve the owner internally on every operation:

```csharp
public sealed class NotesRepository(ID1Database database, ICurrentUser currentUser)
{
    public async Task<int> DeleteAsync(string id, CancellationToken ct = default) =>
        await database.ExecuteAsync(
            "DELETE FROM notes WHERE id = ?1 AND owner_id = ?2",
            [id, await currentUser.GetRequiredIdAsync(ct)], ct);
}
```

Use the same ownership predicate for reads and updates. Keep cross-user isolation
browser tests when replacing the sample repository. See [session consistency](security-model.md)
for the remaining race between authorization and an in-flight database operation.

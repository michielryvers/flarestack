using System.IO.Compression;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Text.Json;

if (args.Length != 3)
{
    throw new ArgumentException("Usage: verify-symbols.cs <package-directory> <version> <commit>");
}
string[] packages = ["Flarestack.D1", "Flarestack.Authentication", "Flarestack.Email", "Aspire.Hosting.Flarestack"];
var sourceLinkKind = new Guid("CC110556-A091-4D38-9FEC-25AB9A351A6A");
var expectedSourcePrefix = $"https://raw.githubusercontent.com/michielryvers/flarestack/{args[2]}/";
if (Directory.GetFiles(args[0], "*.snupkg").Length != packages.Length || Directory.GetFiles(args[0], "*.nupkg").Length != packages.Length)
{
    throw new InvalidOperationException("Expected exactly four framework symbol packages.");
}
foreach (var package in packages)
{
    using var symbols = ZipFile.OpenRead(Path.Combine(args[0], $"{package}.{args[1]}.snupkg"));
    using var library = ZipFile.OpenRead(Path.Combine(args[0], $"{package}.{args[1]}.nupkg"));
    var pdbEntry = symbols.Entries.Single(entry => entry.FullName.EndsWith($"/{package}.pdb", StringComparison.Ordinal));
    using var pdbStream = new MemoryStream();
    using (var source = pdbEntry.Open())
    {
        source.CopyTo(pdbStream);
    }
    pdbStream.Position = 0;
    using var provider = MetadataReaderProvider.FromPortablePdbStream(pdbStream);
    var reader = provider.GetMetadataReader();
    var sourceLinks = reader.CustomDebugInformation
        .Select(reader.GetCustomDebugInformation)
        .Where(info => reader.GetGuid(info.Kind) == sourceLinkKind)
        .ToArray();
    if (sourceLinks.Length != 1)
    {
        throw new InvalidOperationException($"{package} must contain one Source Link document.");
    }
    using var mapping = JsonDocument.Parse(reader.GetBlobBytes(sourceLinks[0].Value));
    var documents = mapping.RootElement.GetProperty("documents").EnumerateObject().ToArray();
    if (documents.Length == 0 || documents.Any(document => !document.Value.GetString()!.StartsWith(expectedSourcePrefix, StringComparison.Ordinal)))
    {
        throw new InvalidOperationException($"{package} Source Link must target the exact repository commit.");
    }
    var sourceDocuments = reader.Documents.Select(handle => reader.GetString(reader.GetDocument(handle).Name)).ToArray();
    bool IsMapped(string path) => documents.Any(mapping => path.StartsWith(mapping.Name.TrimEnd('*'), StringComparison.Ordinal));
    if (!sourceDocuments.Any(IsMapped))
    {
        throw new InvalidOperationException($"{package} Source Link does not map any PDB source document.");
    }
    if (package == "Flarestack.D1" && !sourceDocuments.Any(path => path.Replace('\\', '/').EndsWith("/src/Shared/Protocol.cs", StringComparison.Ordinal) && IsMapped(path)))
    {
        throw new InvalidOperationException("Flarestack.D1 symbols must include the shared protocol source.");
    }
    var dllEntry = library.GetEntry(Path.ChangeExtension(pdbEntry.FullName, ".dll"))
        ?? throw new InvalidOperationException($"{package} has no corresponding assembly.");
    using var dllStream = new MemoryStream();
    using (var source = dllEntry.Open())
    {
        source.CopyTo(dllStream);
    }
    dllStream.Position = 0;
    using var pe = new PEReader(dllStream);
    var codeView = pe.ReadDebugDirectory().Single(entry => entry.Type == DebugDirectoryEntryType.CodeView);
    var assemblyPdbId = pe.ReadCodeViewDebugDirectoryData(codeView).Guid;
    var symbolPdbId = new Guid(reader.DebugMetadataHeader!.Id.AsSpan(0, 16));
    if (assemblyPdbId != symbolPdbId)
    {
        throw new InvalidOperationException($"{package} symbols do not match its assembly.");
    }
    Console.WriteLine($"PASS: {package} portable PDB matches assembly and maps sources to the release commit.");
}

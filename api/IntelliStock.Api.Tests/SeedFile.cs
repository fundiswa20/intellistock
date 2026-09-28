using System.Text.RegularExpressions;

namespace IntelliStock.Api.Tests;

// Reads the repository's own schema and seed scripts, so the tests run against exactly
// what the MySQL container loads, and the test password is never duplicated in code.
public static partial class SeedFile
{
    public static string RepoRoot { get; } = FindRepoRoot();

    public static string SchemaSql => File.ReadAllText(Path.Combine(RepoRoot, "db", "init", "01-schema.sql"));
    public static string SeedSql => File.ReadAllText(Path.Combine(RepoRoot, "db", "init", "02-seed.sql"));

    // the seed header records the test password for every seeded user
    public static string TestPassword => PasswordLine().Match(SeedSql).Groups[1].Value;

    public static string PasswordHashFor(string email) =>
        Regex.Match(SeedSql, $@"\(\d+, '{Regex.Escape(email)}', '([^']+)'").Groups[1].Value;

    private static string FindRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "db", "init")))
            dir = dir.Parent;
        return dir?.FullName ?? throw new DirectoryNotFoundException("Could not find the repository root (db/init).");
    }

    [GeneratedRegex(@"password '([^']+)' \(test data only\)")]
    private static partial Regex PasswordLine();
}

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using IntelliStock.Api.Controllers;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using MySqlConnector;

namespace IntelliStock.Api.Tests.Integration;

// Hosts the real API in memory against a real MySQL database, `intellistock_test`, built
// fresh for each test run from db/init/01-schema.sql and 02-seed.sql - so the FR-04
// triggers and constraints under test are the real ones. Only the model service is
// replaced, by StubModelService, so each ETR-03 path can be forced.
//
// Needs the compose MySQL running (docker compose up -d db). Override the server with
// TEST_MYSQL, e.g. "Server=localhost;Port=3308;User=root;Password=devpassword".
public class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    public const string Database = "intellistock_test";
    public static string MySqlServer =>
        Environment.GetEnvironmentVariable("TEST_MYSQL") ?? "Server=localhost;Port=3308;User=root;Password=devpassword";
    public static string ConnectionString => $"{MySqlServer};Database={Database}";

    public StubModelService Model { get; } = new();

    public async Task InitializeAsync()
    {
        await using var conn = new MySqlConnection(MySqlServer);
        await conn.OpenAsync();
        await Exec(conn, $"DROP DATABASE IF EXISTS {Database}; CREATE DATABASE {Database};");
        foreach (var script in new[] { SeedFile.SchemaSql, SeedFile.SeedSql })
            foreach (var statement in Statements(script.Replace("USE intellistock;", $"USE {Database};")))
                await Exec(conn, statement);
    }

    Task IAsyncLifetime.DisposeAsync() => Task.CompletedTask;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.UseSetting("ConnectionStrings:Inventory", ConnectionString);
        builder.ConfigureServices(s =>
            s.AddHttpClient(StockController.ModelClient).ConfigurePrimaryHttpMessageHandler(() => Model));
    }

    public async Task<HttpClient> LoginAs(string email)
    {
        var client = CreateClient();
        var response = await client.PostAsJsonAsync("/api/auth/login", new { email, password = SeedFile.TestPassword });
        response.EnsureSuccessStatusCode();
        var token = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    public static async Task<T> Scalar<T>(string sql)
    {
        await using var conn = new MySqlConnection(ConnectionString);
        await conn.OpenAsync();
        var value = await new MySqlCommand(sql, conn).ExecuteScalarAsync();
        return (T)Convert.ChangeType(value!, typeof(T));
    }

    public static async Task ExecSql(string sql)
    {
        await using var conn = new MySqlConnection(ConnectionString);
        await conn.OpenAsync();
        await Exec(conn, sql);
    }

    private static async Task Exec(MySqlConnection conn, string sql)
    {
        await using var cmd = new MySqlCommand(sql, conn) { CommandTimeout = 120 };
        await cmd.ExecuteNonQueryAsync();
    }

    // DELIMITER is a mysql command-line client directive, not SQL, so the scripts are
    // split into statements here the way the client would
    private static IEnumerable<string> Statements(string script)
    {
        var delimiter = ";";
        var current = new StringBuilder();
        foreach (var line in script.Split('\n'))
        {
            var trimmed = line.Trim();
            if (trimmed.StartsWith("DELIMITER ", StringComparison.OrdinalIgnoreCase))
            {
                delimiter = trimmed["DELIMITER ".Length..].Trim();
                continue;
            }
            if (current.Length == 0 && (trimmed.Length == 0 || trimmed.StartsWith("--"))) continue;
            current.AppendLine(line);
            if (trimmed.EndsWith(delimiter))
            {
                var sql = current.ToString().TrimEnd();
                yield return sql[..^delimiter.Length];
                current.Clear();
            }
        }
    }
}

// Stands in for ReorderPredictionService. Records every request, answers with whatever
// Respond returns. Default: a confident prediction of 3.5 units/day.
public class StubModelService : HttpMessageHandler
{
    public List<JsonElement> Requests { get; } = [];
    public Func<JsonElement, HttpResponseMessage> Respond { get; set; } = _ => Confident(3.5);

    public static HttpResponseMessage Confident(double demand, double confidence = 0.85) =>
        Json(HttpStatusCode.OK, new
        {
            predictedDailyDemand = demand, confidence, lowConfidence = confidence < 0.6,
            modelVersion = "v1.1-relative", sufficientHistory = true,
        });

    public static HttpResponseMessage Json(HttpStatusCode status, object body) =>
        new(status) { Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json") };

    public void Reset()
    {
        Requests.Clear();
        Respond = _ => Confident(3.5);
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(ct)).RootElement.Clone();
        Requests.Add(body);
        return Respond(body);
    }

    // the HTTP client factory disposes handlers it rotates out; this one is shared, so it stays usable
    protected override void Dispose(bool disposing) { }
}

[CollectionDefinition(Name)]
public class ApiCollection : ICollectionFixture<ApiFactory>
{
    public const string Name = "api";
}

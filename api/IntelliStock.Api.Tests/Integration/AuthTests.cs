using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace IntelliStock.Api.Tests.Integration;

// FR-02: login
[Trait("Category", "Integration")]
[Collection(ApiCollection.Name)]
public class AuthTests(ApiFactory api)
{
    [Fact]
    public async Task Owner_logs_in_with_seeded_credentials_and_gets_a_token()
    {
        var response = await api.CreateClient().PostAsJsonAsync("/api/auth/login",
            new { email = "nomvula@intellistock.test", password = SeedFile.TestPassword });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(string.IsNullOrEmpty(body.GetProperty("token").GetString()));
        Assert.Equal("BusinessOwner", body.GetProperty("user").GetProperty("role").GetString());
        Assert.Equal("Nomvula's Spaza", body.GetProperty("user").GetProperty("businessName").GetString());
    }

    [Theory]
    [InlineData("nomvula@intellistock.test", "wrong-password")]
    [InlineData("nobody@intellistock.test", "any-password")]
    public async Task Wrong_password_and_unknown_email_get_the_same_401(string email, string password)
    {
        var response = await api.CreateClient().PostAsJsonAsync("/api/auth/login", new { email, password });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Email or password is incorrect.", body.GetProperty("title").GetString());
    }

    [Fact]
    public async Task Stock_endpoints_require_a_token()
    {
        var response = await api.CreateClient().GetAsync("/api/stock");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task A_forged_token_is_rejected()
    {
        var client = api.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "eyJhbGciOiJIUzI1NiJ9.e30.forged");
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/stock")).StatusCode);
    }

    [Fact]
    public async Task A_supplier_can_log_in_but_cannot_use_the_stock_endpoints()
    {
        var supplier = await api.LoginAs("orders@ubuntu-wholesale.test");
        Assert.Equal(HttpStatusCode.Forbidden, (await supplier.GetAsync("/api/stock")).StatusCode);
    }
}

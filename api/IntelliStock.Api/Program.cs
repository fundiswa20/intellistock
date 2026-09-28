using System.Security.Claims;
using IntelliStock.Api.Controllers;
using IntelliStock.Api.Data;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

// InventoryRepository: EF Core over MySQL 8 (Pomelo). A fixed server version, so the API
// starts without needing to reach the database first.
builder.Services.AddDbContext<InventoryRepository>(o =>
    o.UseMySql(config.GetConnectionString("Inventory"), new MySqlServerVersion(new Version(8, 0, 45))));

// ReorderPredictionService (Python, FastAPI) - FR-08
builder.Services.AddHttpClient(StockController.ModelClient, c =>
{
    c.BaseAddress = new Uri(config["ModelService:BaseUrl"] ?? "http://localhost:8000");
    c.Timeout = TimeSpan.FromSeconds(config.GetValue("ModelService:TimeoutSeconds", 5));
});

// FR-02: JWT bearer tokens issued by AuthController
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o => o.TokenValidationParameters = new TokenValidationParameters
    {
        ValidIssuer = AuthController.Issuer,
        ValidAudience = AuthController.Issuer,
        IssuerSigningKey = AuthController.SigningKey(config),
        RoleClaimType = ClaimTypes.Role,
        NameClaimType = ClaimTypes.Name,
    });
builder.Services.AddAuthorization();

builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins(config.GetSection("Cors:Origins").Get<string[]>() ?? ["http://localhost:4201"])
    .AllowAnyHeader().AllowAnyMethod()));

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

app.UseSwagger();
app.UseSwaggerUI();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

app.MapGet("/health", async (InventoryRepository db) =>
    await db.Database.CanConnectAsync()
        ? Results.Ok(new { status = "ok", database = "connected" })
        : Results.Json(new { status = "degraded", database = "unreachable" }, statusCode: 503));

app.Run();

// lets the integration tests host the API with WebApplicationFactory
public partial class Program;

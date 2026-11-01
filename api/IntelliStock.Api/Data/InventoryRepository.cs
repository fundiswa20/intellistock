using IntelliStock.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace IntelliStock.Api.Data;

// UML: InventoryRepository - the data-access component. It is the EF Core DbContext
// itself, used directly by the controllers; there is no repository pattern layered
// on top of it (D15, O3). The schema is created and versioned by EF Core migrations,
// applied at startup (supersedes D18).
public class InventoryRepository(DbContextOptions<InventoryRepository> options) : DbContext(options)
{
    public DbSet<RegisteredUser> RegisteredUsers => Set<RegisteredUser>();
    public DbSet<BusinessOwner> BusinessOwners => Set<BusinessOwner>();
    public DbSet<Supplier> Suppliers => Set<Supplier>();
    public DbSet<StockItem> StockItems => Set<StockItem>();
    public DbSet<Transaction> Transactions => Set<Transaction>();
    public DbSet<Alert> Alerts => Set<Alert>();
    public DbSet<ReorderPrediction> ReorderPredictions => Set<ReorderPrediction>();
    public DbSet<SupplierListing> SupplierListings => Set<SupplierListing>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<OrderLine> OrderLines => Set<OrderLine>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        // table-per-type: BusinessOwner and Supplier share RegisteredUser's key
        b.Entity<RegisteredUser>().UseTptMappingStrategy().ToTable("RegisteredUser");
        b.Entity<BusinessOwner>().ToTable("BusinessOwner");
        b.Entity<Supplier>().ToTable("Supplier");
        b.Entity<RegisteredUser>(e =>
        {
            e.Property(x => x.Email).HasMaxLength(255).IsRequired();
            e.HasIndex(x => x.Email).IsUnique();
            e.Property(x => x.PasswordHash).HasMaxLength(255).IsRequired();
            e.Property(x => x.FullName).HasMaxLength(120).IsRequired();
            e.Property(x => x.Role).HasMaxLength(20).IsRequired();
        });

        b.Entity<BusinessOwner>(e =>
        {
            e.Property(x => x.BusinessName).HasMaxLength(120).IsRequired();
            e.Property(x => x.Location).HasMaxLength(120).IsRequired();
            e.Property(x => x.Phone).HasMaxLength(20);
        });

        b.Entity<Supplier>(e =>
        {
            e.Property(x => x.CompanyName).HasMaxLength(120).IsRequired();
            e.Property(x => x.Phone).HasMaxLength(20);
            e.Property(x => x.DeliveryArea).HasMaxLength(120);
            e.Property(x => x.ReliabilityScore).HasPrecision(4, 3).HasDefaultValue(0.800m);            e.HasIndex(x => x.DeliveryArea);
        });

        b.Entity<StockItem>(e =>
        {
            e.ToTable("StockItem");
            e.HasOne<BusinessOwner>().WithMany().HasForeignKey(s => s.BusinessOwnerId);
            e.Property(x => x.Name).HasMaxLength(120).IsRequired();
            e.Property(x => x.Category).HasMaxLength(40).IsRequired();
            e.Property(x => x.Unit).HasMaxLength(30).IsRequired();
            e.Property(x => x.UnitCost).HasPrecision(10, 2);
            e.Property(x => x.SellingPrice).HasPrecision(10, 2);
            e.HasIndex(x => new { x.BusinessOwnerId, x.IsActive });
        });

        // FR-04: the triggers are declared so the model documents them; they live in SQL
        b.Entity<Transaction>(e =>
        {
            e.ToTable("Transaction", t =>
            {
                t.HasTrigger("TR_Transaction_NoUpdate");
                t.HasTrigger("TR_Transaction_NoDelete");
            });
            e.HasOne<StockItem>().WithMany().HasForeignKey(t => t.StockItemId);
            e.HasOne<RegisteredUser>().WithMany().HasForeignKey(t => t.RecordedByUserId);
            e.Property(x => x.Type).HasMaxLength(20).IsRequired();
            e.Property(x => x.Note).HasMaxLength(255);
            e.HasIndex(x => new { x.StockItemId, x.OccurredAt });
        });

        // Alert.OpenFlag is a generated column used only by the one-open-alert unique key,
        // so it is deliberately not mapped
        b.Entity<Alert>(e =>
        {
            e.ToTable("Alert");
            e.HasOne<StockItem>().WithMany().HasForeignKey(a => a.StockItemId);
            e.Property(x => x.Type).HasMaxLength(20).IsRequired();
            e.Property(x => x.Message).HasMaxLength(255).IsRequired();
        });

        b.Entity<ReorderPrediction>(e =>
        {
            e.ToTable("ReorderPrediction");
            e.HasOne<StockItem>().WithMany().HasForeignKey(p => p.StockItemId);
            e.Property(x => x.PredictedDailyDemand).HasPrecision(10, 3);
            e.Property(x => x.Confidence).HasPrecision(4, 3);
            e.Property(x => x.DaysUntilStockOut).HasPrecision(8, 1);
            e.Property(x => x.ModelVersion).HasMaxLength(40);
            e.Property(x => x.FallbackReason).HasMaxLength(40);
            e.HasIndex(x => new { x.StockItemId, x.CreatedAt });
        });

        b.Entity<SupplierListing>(e =>
        {
            e.ToTable("SupplierListing");
            e.HasOne<Supplier>().WithMany().HasForeignKey(l => l.SupplierId);
            e.Property(x => x.ProductName).HasMaxLength(120).IsRequired();
            e.Property(x => x.Category).HasMaxLength(40).IsRequired();
            e.Property(x => x.PackPrice).HasPrecision(10, 2);
            e.Property(x => x.IsActive).HasDefaultValue(true);
            e.Property(x => x.AvailableQuantity).HasDefaultValue(0);
            e.Property(x => x.DeliveryCost).HasPrecision(10, 2).HasDefaultValue(0m);
            e.HasIndex(x => new { x.ProductName, x.IsActive });
        });

        b.Entity<Order>(e =>
        {
            e.ToTable("Order");
            e.HasOne<BusinessOwner>().WithMany().HasForeignKey(o => o.BusinessOwnerId);
            e.HasOne<Supplier>().WithMany().HasForeignKey(o => o.SupplierId);
            e.Property(x => x.Status).HasMaxLength(20).IsRequired();
            e.Property(x => x.TotalCost).HasPrecision(10, 2);
            e.HasIndex(x => new { x.BusinessOwnerId, x.PlacedAt });
        });

        b.Entity<OrderLine>(e =>
        {
            e.ToTable("OrderLine");
            e.HasOne<Order>().WithMany().HasForeignKey(o => o.OrderId);
            e.HasOne<SupplierListing>().WithMany().HasForeignKey(o => o.SupplierListingId)
                .OnDelete(DeleteBehavior.Restrict);
            e.HasOne<StockItem>().WithMany().HasForeignKey(o => o.StockItemId).IsRequired(false);
            e.Property(x => x.UnitPrice).HasPrecision(10, 2);
            e.Property(x => x.LineTotal).HasPrecision(10, 2);
            e.HasIndex(x => x.OrderId);
        });
    }
}

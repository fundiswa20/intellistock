using IntelliStock.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace IntelliStock.Api.Data;

// UML: InventoryRepository - the data-access component. It is the EF Core DbContext
// itself, used directly by the controllers; there is no repository pattern layered
// on top of it (D15, O3). It maps onto the schema in db/init/01-schema.sql and does
// not create it (D18).
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

    protected override void OnModelCreating(ModelBuilder b)
    {
        // table-per-type: BusinessOwner and Supplier share RegisteredUser's key
        b.Entity<RegisteredUser>().UseTptMappingStrategy().ToTable("RegisteredUser");
        b.Entity<BusinessOwner>().ToTable("BusinessOwner");
        b.Entity<Supplier>().ToTable("Supplier");

        b.Entity<StockItem>(e =>
        {
            e.ToTable("StockItem");
            e.HasOne<BusinessOwner>().WithMany().HasForeignKey(s => s.BusinessOwnerId);
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
        });

        // Alert.OpenFlag is a generated column used only by the one-open-alert unique key,
        // so it is deliberately not mapped
        b.Entity<Alert>(e =>
        {
            e.ToTable("Alert");
            e.HasOne<StockItem>().WithMany().HasForeignKey(a => a.StockItemId);
        });

        b.Entity<ReorderPrediction>(e =>
        {
            e.ToTable("ReorderPrediction");
            e.HasOne<StockItem>().WithMany().HasForeignKey(p => p.StockItemId);
        });

        b.Entity<SupplierListing>(e =>
        {
            e.ToTable("SupplierListing");
            e.HasOne<Supplier>().WithMany().HasForeignKey(l => l.SupplierId);
        });
    }
}

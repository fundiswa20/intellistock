-- IntelliStock schema - MySQL 8.0
--
-- Table names match the classes in the submitted UML class diagram exactly.
-- RegisteredUser is the base class; BusinessOwner and Supplier each have their own
-- table sharing its primary key (table-per-type, mapped the same way in EF Core).
--
-- Run automatically by the mysql container from /docker-entrypoint-initdb.d on first
-- start; 02-seed.sql runs after it.

SET NAMES utf8mb4;
USE intellistock;

-- ---------------------------------------------------------------- users

-- FR-01 / FR-02: users are seeded; there is no registration UI (FR-01 Partial)
CREATE TABLE RegisteredUser (
    RegisteredUserId  INT           NOT NULL AUTO_INCREMENT,
    Email             VARCHAR(255)  NOT NULL,
    PasswordHash      VARCHAR(255)  NOT NULL,   -- ASP.NET Core Identity PasswordHasher v3 format
    FullName          VARCHAR(120)  NOT NULL,
    Role              VARCHAR(20)   NOT NULL,
    CreatedAt         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (RegisteredUserId),
    UNIQUE KEY UX_RegisteredUser_Email (Email),
    CONSTRAINT CK_RegisteredUser_Role CHECK (Role IN ('BusinessOwner', 'Supplier'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE BusinessOwner (
    RegisteredUserId  INT           NOT NULL,
    BusinessName      VARCHAR(120)  NOT NULL,
    Location          VARCHAR(120)  NOT NULL,
    Phone             VARCHAR(20)   NULL,
    PRIMARY KEY (RegisteredUserId),
    CONSTRAINT FK_BusinessOwner_RegisteredUser FOREIGN KEY (RegisteredUserId)
        REFERENCES RegisteredUser (RegisteredUserId) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- FR-06 / FR-07: supplier data is seeded; no supplier interface (Partial)
CREATE TABLE Supplier (
    RegisteredUserId  INT           NOT NULL,
    CompanyName       VARCHAR(120)  NOT NULL,
    Phone             VARCHAR(20)   NULL,
    DeliveryArea      VARCHAR(120)  NULL,
    PRIMARY KEY (RegisteredUserId),
    CONSTRAINT FK_Supplier_RegisteredUser FOREIGN KEY (RegisteredUserId)
        REFERENCES RegisteredUser (RegisteredUserId) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------- stock

-- FR-03: stock item CRUD. Delete is a soft delete (IsActive = 0): a hard delete
-- would have to delete the item's transactions, and FR-04 makes those immutable.
CREATE TABLE StockItem (
    StockItemId       INT            NOT NULL AUTO_INCREMENT,
    BusinessOwnerId   INT            NOT NULL,
    Name              VARCHAR(120)   NOT NULL,
    Category          VARCHAR(40)    NOT NULL,   -- must be a category the model knows (D16/O2)
    Unit              VARCHAR(30)    NOT NULL DEFAULT 'each',
    QuantityOnHand    INT            NOT NULL DEFAULT 0,
    ReorderLevel      INT            NOT NULL DEFAULT 0,
    UnitCost          DECIMAL(10,2)  NOT NULL,
    SellingPrice      DECIMAL(10,2)  NOT NULL,
    IsActive          TINYINT(1)     NOT NULL DEFAULT 1,
    CreatedAt         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (StockItemId),
    KEY IX_StockItem_Owner (BusinessOwnerId, IsActive),
    CONSTRAINT FK_StockItem_BusinessOwner FOREIGN KEY (BusinessOwnerId)
        REFERENCES BusinessOwner (RegisteredUserId),
    CONSTRAINT CK_StockItem_Quantity CHECK (QuantityOnHand >= 0),
    CONSTRAINT CK_StockItem_ReorderLevel CHECK (ReorderLevel >= 0),
    CONSTRAINT CK_StockItem_Prices CHECK (UnitCost >= 0 AND SellingPrice >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- FR-04: the stock movement log. Rows are append-only - see the triggers below.
-- QuantityChange is signed (a sale is negative); QuantityAfter is the balance after
-- the movement, so the log can be audited against StockItem.QuantityOnHand.
CREATE TABLE `Transaction` (
    TransactionId     BIGINT         NOT NULL AUTO_INCREMENT,
    StockItemId       INT            NOT NULL,
    Type              VARCHAR(20)    NOT NULL,
    QuantityChange    INT            NOT NULL,
    QuantityAfter     INT            NOT NULL,
    OccurredAt        DATETIME       NOT NULL,
    RecordedByUserId  INT            NOT NULL,
    Note              VARCHAR(255)   NULL,
    PRIMARY KEY (TransactionId),
    KEY IX_Transaction_Item_Time (StockItemId, OccurredAt),
    CONSTRAINT FK_Transaction_StockItem FOREIGN KEY (StockItemId)
        REFERENCES StockItem (StockItemId) ON DELETE RESTRICT,
    CONSTRAINT FK_Transaction_RecordedBy FOREIGN KEY (RecordedByUserId)
        REFERENCES RegisteredUser (RegisteredUserId),
    CONSTRAINT CK_Transaction_Type CHECK (Type IN ('Sale', 'Restock', 'Adjustment')),
    CONSTRAINT CK_Transaction_Sign CHECK (
        (Type = 'Sale'    AND QuantityChange < 0) OR
        (Type = 'Restock' AND QuantityChange > 0) OR
        (Type = 'Adjustment' AND QuantityChange <> 0)),
    CONSTRAINT CK_Transaction_After CHECK (QuantityAfter >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- FR-04: transactions are immutable. Enforced in the database, not only in the API,
-- so no code path - including a bug or a manual query - can rewrite stock history.
-- A mistake is corrected with a new 'Adjustment' row.
DELIMITER //
CREATE TRIGGER TR_Transaction_NoUpdate BEFORE UPDATE ON `Transaction`
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'FR-04: transactions are immutable - record an Adjustment instead';
END//
CREATE TRIGGER TR_Transaction_NoDelete BEFORE DELETE ON `Transaction`
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'FR-04: transactions are immutable and cannot be deleted';
END//
DELIMITER ;

-- ---------------------------------------------------------------- alerts

-- FR-05: raised when a movement takes QuantityOnHand to or below ReorderLevel;
-- resolved (ResolvedAt set) when a restock takes it back above. At most one open
-- alert per item, enforced by the generated OpenFlag column.
CREATE TABLE Alert (
    AlertId           INT            NOT NULL AUTO_INCREMENT,
    StockItemId       INT            NOT NULL,
    Type              VARCHAR(20)    NOT NULL DEFAULT 'LowStock',
    Message           VARCHAR(255)   NOT NULL,
    QuantityAtAlert   INT            NOT NULL,
    ReorderLevel      INT            NOT NULL,
    CreatedAt         DATETIME       NOT NULL,
    ResolvedAt        DATETIME       NULL,
    OpenFlag          TINYINT(1)     AS (IF(ResolvedAt IS NULL, 1, NULL)) STORED,
    PRIMARY KEY (AlertId),
    UNIQUE KEY UX_Alert_OneOpenPerItem (StockItemId, OpenFlag),
    KEY IX_Alert_Open (ResolvedAt),
    CONSTRAINT FK_Alert_StockItem FOREIGN KEY (StockItemId)
        REFERENCES StockItem (StockItemId),
    CONSTRAINT CK_Alert_Type CHECK (Type IN ('LowStock'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------- predictions

-- FR-08: every prediction shown to the owner is stored, with the model version
-- and whether the ETR-03 fallback was used, so a recommendation can be traced.
CREATE TABLE ReorderPrediction (
    ReorderPredictionId   INT            NOT NULL AUTO_INCREMENT,
    StockItemId           INT            NOT NULL,
    PredictedDailyDemand  DECIMAL(10,3)  NOT NULL,
    Confidence            DECIMAL(4,3)   NULL,       -- NULL when the model was not used
    DaysUntilStockOut     DECIMAL(8,1)   NULL,       -- NULL when demand is 0 (D17)
    RecommendedQuantity   INT            NOT NULL,
    ModelVersion          VARCHAR(40)    NULL,
    UsedFallback          TINYINT(1)     NOT NULL DEFAULT 0,
    FallbackReason        VARCHAR(40)    NULL,       -- 'insufficientHistory' | 'lowConfidence' | 'modelUnavailable'
    CreatedAt             DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ReorderPredictionId),
    KEY IX_ReorderPrediction_Item_Time (StockItemId, CreatedAt),
    CONSTRAINT FK_ReorderPrediction_StockItem FOREIGN KEY (StockItemId)
        REFERENCES StockItem (StockItemId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------- supplier listings

-- FR-06 / FR-07: seeded directly (Partial)
CREATE TABLE SupplierListing (
    SupplierListingId INT            NOT NULL AUTO_INCREMENT,
    SupplierId        INT            NOT NULL,
    ProductName       VARCHAR(120)   NOT NULL,
    Category          VARCHAR(40)    NOT NULL,
    PackSize          INT            NOT NULL DEFAULT 1,
    PackPrice         DECIMAL(10,2)  NOT NULL,
    LeadTimeDays      INT            NOT NULL DEFAULT 1,
    UpdatedAt         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (SupplierListingId),
    KEY IX_SupplierListing_Product (ProductName),
    CONSTRAINT FK_SupplierListing_Supplier FOREIGN KEY (SupplierId)
        REFERENCES Supplier (RegisteredUserId),
    CONSTRAINT CK_SupplierListing CHECK (PackSize > 0 AND PackPrice >= 0 AND LeadTimeDays >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

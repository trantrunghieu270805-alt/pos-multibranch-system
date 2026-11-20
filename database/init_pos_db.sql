USE master;
GO

IF DB_ID(N'MultiBranchPOS') IS NOT NULL
BEGIN
    ALTER DATABASE [MultiBranchPOS] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [MultiBranchPOS];
END;
GO

CREATE DATABASE [MultiBranchPOS];
GO

USE [MultiBranchPOS];
GO

CREATE TABLE dbo.Branches (
    BranchID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Branches PRIMARY KEY,
    BranchName NVARCHAR(100) NOT NULL,
    Address NVARCHAR(255) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_Branches_IsActive DEFAULT (1)
);
GO

CREATE TABLE dbo.Users (
    UserID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Users PRIMARY KEY,
    FullName NVARCHAR(120) NOT NULL,
    Username NVARCHAR(80) NOT NULL CONSTRAINT UQ_Users_Username UNIQUE,
    PasswordHash NVARCHAR(100) NOT NULL,
    Role NVARCHAR(20) NOT NULL,
    BranchID INT NULL,
    DeliveryArea NVARCHAR(100) NULL,
    Phone NVARCHAR(30) NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_Users_Role CHECK (Role IN (N'CUSTOMER', N'MANAGER', N'CHEF', N'SHIPPER')),
    CONSTRAINT FK_Users_Branches FOREIGN KEY (BranchID) REFERENCES dbo.Branches(BranchID)
);
GO

CREATE TABLE dbo.DiningTables (
    TableID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DiningTables PRIMARY KEY,
    BranchID INT NOT NULL,
    TableName NVARCHAR(50) NOT NULL,
    Status NVARCHAR(30) NOT NULL CONSTRAINT DF_DiningTables_Status DEFAULT (N'Available'),
    CONSTRAINT UQ_DiningTables_Branch_Table UNIQUE (BranchID, TableName),
    CONSTRAINT CK_DiningTables_Status CHECK (Status IN (N'Available', N'Occupied')),
    CONSTRAINT FK_DiningTables_Branches FOREIGN KEY (BranchID) REFERENCES dbo.Branches(BranchID)
);
GO

CREATE TABLE dbo.Categories (
    CategoryID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Categories PRIMARY KEY,
    CategoryName NVARCHAR(100) NOT NULL CONSTRAINT UQ_Categories_CategoryName UNIQUE
);
GO

CREATE TABLE dbo.Products (
    ProductID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Products PRIMARY KEY,
    CategoryID INT NOT NULL,
    ProductName NVARCHAR(150) NOT NULL,
    Price DECIMAL(18,0) NOT NULL,
    ImageUrl NVARCHAR(500) NULL,
    IsAvailable BIT NOT NULL CONSTRAINT DF_Products_IsAvailable DEFAULT (1),
    CONSTRAINT CK_Products_Price CHECK (Price >= 0),
    CONSTRAINT FK_Products_Categories FOREIGN KEY (CategoryID) REFERENCES dbo.Categories(CategoryID)
);
GO

CREATE TABLE dbo.Orders (
    OrderID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Orders PRIMARY KEY,
    BranchID INT NOT NULL,
    TableID INT NULL,
    CustomerID INT NULL,
    DeliveryAddress NVARCHAR(255) NULL,
    DeliveryArea NVARCHAR(100) NULL,
    ShipperID INT NULL,
    TotalAmount DECIMAL(18,0) NOT NULL CONSTRAINT DF_Orders_TotalAmount DEFAULT (0),
    Status NVARCHAR(30) NOT NULL CONSTRAINT DF_Orders_Status DEFAULT (N'Chờ duyệt'),
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Orders_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_Orders_Status CHECK (
        Status IN (N'Chờ duyệt', N'Chờ chế biến', N'Đang chế biến',
                   N'Bếp hoàn thành', N'Đang giao hàng', N'Hoàn tất')
    ),
    CONSTRAINT FK_Orders_Branches FOREIGN KEY (BranchID) REFERENCES dbo.Branches(BranchID),
    CONSTRAINT FK_Orders_DiningTables FOREIGN KEY (TableID) REFERENCES dbo.DiningTables(TableID),
    CONSTRAINT FK_Orders_Customers FOREIGN KEY (CustomerID) REFERENCES dbo.Users(UserID),
    CONSTRAINT FK_Orders_Shippers FOREIGN KEY (ShipperID) REFERENCES dbo.Users(UserID)
);
GO

CREATE TABLE dbo.OrderItems (
    OrderItemID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_OrderItems PRIMARY KEY,
    OrderID INT NOT NULL,
    ProductID INT NOT NULL,
    Quantity INT NOT NULL,
    UnitPrice DECIMAL(18,0) NOT NULL,
    Note NVARCHAR(255) NULL,
    CONSTRAINT CK_OrderItems_Quantity CHECK (Quantity > 0),
    CONSTRAINT CK_OrderItems_UnitPrice CHECK (UnitPrice >= 0),
    CONSTRAINT FK_OrderItems_Orders FOREIGN KEY (OrderID)
        REFERENCES dbo.Orders(OrderID) ON DELETE CASCADE,
    CONSTRAINT FK_OrderItems_Products FOREIGN KEY (ProductID) REFERENCES dbo.Products(ProductID)
);
GO

CREATE INDEX IX_Orders_Status_Branch ON dbo.Orders (Status, BranchID);
CREATE INDEX IX_Orders_Customer_Created ON dbo.Orders (CustomerID, CreatedAt DESC);
CREATE INDEX IX_Orders_Area_Status ON dbo.Orders (DeliveryArea, Status);
CREATE INDEX IX_OrderItems_OrderID ON dbo.OrderItems (OrderID);
GO

INSERT INTO dbo.Branches (BranchName, Address)
VALUES
    (N'Chi nhánh trung tâm', N'Quận 1, TP. Hồ Chí Minh'),
    (N'Chi nhánh Thủ Đức', N'TP. Thủ Đức, TP. Hồ Chí Minh');

DECLARE @branchID INT = (SELECT TOP (1) BranchID FROM dbo.Branches ORDER BY BranchID);
DECLARE @seedPasswordHash NVARCHAR(100) =
    N'$2b$10$VsTNb/iNt/9EG2VvCoXI3OqCujWZpWRzFOwm9tXyyUIJQZnlZxsfK';

-- Mật khẩu chung cho tài khoản mẫu: Admin@123
INSERT INTO dbo.Users (FullName, Username, PasswordHash, Role, BranchID, DeliveryArea, Phone)
VALUES
    (N'Khách hàng mẫu', N'customer.demo', @seedPasswordHash, N'CUSTOMER', NULL, NULL, N'0900000001'),
    (N'Quản lý mẫu', N'manager.demo', @seedPasswordHash, N'MANAGER', NULL, NULL, N'0900000002'),
    (N'Đầu bếp mẫu', N'chef.demo', @seedPasswordHash, N'CHEF', @branchID, NULL, N'0900000003'),
    (N'Nhân viên giao hàng mẫu', N'shipper.demo', @seedPasswordHash, N'SHIPPER', NULL, N'Quận 1', N'0900000004');

INSERT INTO dbo.Categories (CategoryName)
VALUES (N'Đồ uống'), (N'Món ăn');

INSERT INTO dbo.Products (CategoryID, ProductName, Price, ImageUrl)
SELECT category.CategoryID, product.ProductName, product.Price, NULL
FROM (VALUES
    (N'Đồ uống', N'Cà phê sữa', 35000),
    (N'Đồ uống', N'Trà đào', 40000),
    (N'Món ăn', N'Bánh mì thịt', 45000)
) AS product(CategoryName, ProductName, Price)
JOIN dbo.Categories AS category ON category.CategoryName = product.CategoryName;

INSERT INTO dbo.DiningTables (BranchID, TableName)
SELECT branch.BranchID, N'Bàn ' + CONVERT(NVARCHAR(10), tableNumber.TableNumber)
FROM dbo.Branches AS branch
CROSS JOIN (VALUES (1), (2), (3), (4)) AS tableNumber(TableNumber);
GO

SELECT
    (SELECT COUNT(*) FROM dbo.Branches) AS BranchCount,
    (SELECT COUNT(*) FROM dbo.Users) AS UserCount,
    (SELECT COUNT(*) FROM dbo.Categories) AS CategoryCount,
    (SELECT COUNT(*) FROM dbo.Products) AS ProductCount,
    (SELECT COUNT(*) FROM dbo.DiningTables) AS DiningTableCount;
GO

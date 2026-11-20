IF DB_ID(N'PosMultiBranch') IS NULL
BEGIN
    CREATE DATABASE PosMultiBranch;
END;
GO

USE PosMultiBranch;
GO

IF OBJECT_ID(N'dbo.Branches', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Branches (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        Name NVARCHAR(120) NOT NULL,
        Address NVARCHAR(255) NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_Branches_IsActive DEFAULT (1)
    );
END;
GO

IF OBJECT_ID(N'dbo.Products', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Products (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        Name NVARCHAR(150) NOT NULL,
        Price DECIMAL(12,2) NOT NULL CHECK (Price >= 0),
        Category NVARCHAR(80) NOT NULL,
        IsAvailable BIT NOT NULL CONSTRAINT DF_Products_IsAvailable DEFAULT (1)
    );
END;
GO

IF OBJECT_ID(N'dbo.Orders', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Orders (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        BranchId INT NOT NULL,
        TableNumber NVARCHAR(20) NOT NULL,
        Status NVARCHAR(20) NOT NULL CONSTRAINT DF_Orders_Status DEFAULT (N'pending'),
        TotalAmount DECIMAL(12,2) NOT NULL CONSTRAINT DF_Orders_TotalAmount DEFAULT (0),
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Orders_CreatedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT FK_Orders_Branches FOREIGN KEY (BranchId) REFERENCES dbo.Branches(Id)
    );
END;
GO

IF OBJECT_ID(N'dbo.OrderItems', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.OrderItems (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        OrderId INT NOT NULL,
        ProductId INT NOT NULL,
        Quantity INT NOT NULL CHECK (Quantity > 0),
        UnitPrice DECIMAL(12,2) NOT NULL CHECK (UnitPrice >= 0),
        CONSTRAINT FK_OrderItems_Orders FOREIGN KEY (OrderId) REFERENCES dbo.Orders(Id),
        CONSTRAINT FK_OrderItems_Products FOREIGN KEY (ProductId) REFERENCES dbo.Products(Id)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Branches)
BEGIN
    INSERT INTO dbo.Branches (Name, Address)
    VALUES (N'Chi nhánh trung tâm', N'Quận 1, TP. Hồ Chí Minh'),
           (N'Chi nhánh Thủ Đức', N'TP. Thủ Đức, TP. Hồ Chí Minh');
END;

IF NOT EXISTS (SELECT 1 FROM dbo.Products)
BEGIN
    INSERT INTO dbo.Products (Name, Price, Category)
    VALUES (N'Cà phê sữa', 35000, N'Đồ uống'),
           (N'Trà đào', 40000, N'Đồ uống'),
           (N'Bánh mì thịt', 45000, N'Món ăn');
END;
GO

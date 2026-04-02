-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 10000,
    "garage_capacity" INTEGER NOT NULL DEFAULT 3,
    "last_income_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login" TIMESTAMP(3),
    "last_logout" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Car" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "base_price" DOUBLE PRECISION NOT NULL,
    "speed" INTEGER NOT NULL,
    "style" INTEGER NOT NULL,
    "reliability" INTEGER NOT NULL,
    "income_rate" DOUBLE PRECISION NOT NULL,
    "image_path" TEXT NOT NULL,

    CONSTRAINT "Car_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auction" (
    "id" SERIAL NOT NULL,
    "car_id" TEXT NOT NULL,
    "current_highest_bid" DOUBLE PRECISION NOT NULL,
    "highest_bidder_id" INTEGER,
    "start_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_time" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Auction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCar" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "car_id" TEXT NOT NULL,
    "acquired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purchase_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purchase_price" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "UserCar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" SERIAL NOT NULL,
    "auction_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Car_name_key" ON "Car"("name");

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_car_id_fkey" FOREIGN KEY ("car_id") REFERENCES "Car"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_highest_bidder_id_fkey" FOREIGN KEY ("highest_bidder_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCar" ADD CONSTRAINT "UserCar_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCar" ADD CONSTRAINT "UserCar_car_id_fkey" FOREIGN KEY ("car_id") REFERENCES "Car"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "Auction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

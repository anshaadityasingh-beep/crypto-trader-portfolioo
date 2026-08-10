import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Start seeding...');

  // Create 3 test users
  const users = [];
  for (let i = 1; i <= 3; i++) {
    const passwordHash = await bcrypt.hash(`password${i}`, 10);
    const user = await prisma.user.upsert({
      where: { email: `test${i}@example.com` },
      update: {},
      create: {
        email: `test${i}@example.com`,
        passwordHash,
        wallet: {
          create: {
            balance: 10000,
            currency: 'USD',
          },
        },
      },
    });
    users.push(user);
    console.log(`Created user with id: ${user.id} and email: ${user.email}`);
  }

  // Check if we have bot user(s) for the market maker
  const botPasswordHash = await bcrypt.hash('botpassword', 10);
  const botUser = await prisma.user.upsert({
    where: { email: 'bot1@example.com' },
    update: {},
    create: {
      email: 'bot1@example.com',
      passwordHash: botPasswordHash,
      wallet: {
        create: {
          balance: 100000000, // Very large balance for market making
          currency: 'USD',
        },
      },
    },
  });
  console.log(`Created bot user with id: ${botUser.id}`);

  console.log('Seeding finished.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

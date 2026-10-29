// Usage: npm run hash-password -- "your password"
// Prints a bcrypt hash to paste into ADMIN_PASSWORD_HASH.
import bcrypt from "bcryptjs";

const password = process.argv[2];
if (!password || password.length < 10) {
  console.error('Give a password of at least 10 characters: npm run hash-password -- "your password"');
  process.exit(1);
}
console.log(bcrypt.hashSync(password, 12));

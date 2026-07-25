import fs from "fs";
const sizes = [500, 700, 900, 1024, 1200, 1400];
if (!fs.existsSync("testfiles")) fs.mkdirSync("testfiles");
for (const size of sizes) {
  const filePath = `testfiles/test_${size}MB.bin`;
  if (!fs.existsSync(filePath)) {
    console.log(`Generating ${filePath}...`);
    const fd = fs.openSync(filePath, "w");
    fs.writeSync(fd, Buffer.alloc(1), 0, 1, (size * 1024 * 1024) - 1);
    fs.closeSync(fd);
  }
}
console.log("Done generating sparse files.");

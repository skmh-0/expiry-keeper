/**
 * 一键打 Android release APK：自动带上本机 JDK / Android SDK / Gradle 缓存。
 * 没有配置环境变量时回落到这台机器上的 Android 构建目录。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(root, 'android');

const javaHome = process.env.JAVA_HOME || 'D:\\Android-Build\\jdk-17.0.20.1+1';
const sdkDir = process.env.ANDROID_HOME || 'D:\\Android-Build\\sdk';
const gradleUserHome = process.env.GRADLE_USER_HOME || 'D:\\Codex\\.gradle-home';
const gradleBin = 'D:\\Android-Build\\gradle-8.7\\bin\\gradle.bat';

if (!existsSync(join(androidDir, 'app', 'build.gradle'))) {
  console.error('找不到 android 工程，先执行 npx cap add android');
  process.exit(1);
}

const useLocalGradle = existsSync(gradleBin);
const command = useLocalGradle ? gradleBin : 'gradlew.bat';
const args = ['-p', androidDir, 'assembleRelease', '--console=plain'];

console.log(`使用 ${useLocalGradle ? gradleBin : 'gradle wrapper'}`);
console.log(`JAVA_HOME=${javaHome}`);
console.log(`ANDROID_HOME=${sdkDir}`);
console.log(`GRADLE_USER_HOME=${gradleUserHome}`);

const result = spawnSync(command, args, {
  cwd: androidDir,
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    JAVA_HOME: javaHome,
    ANDROID_HOME: sdkDir,
    ANDROID_SDK_ROOT: sdkDir,
    GRADLE_USER_HOME: gradleUserHome,
  },
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const apk = join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
console.log(`\nAPK: ${apk}`);

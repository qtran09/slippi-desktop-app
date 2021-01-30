import AdmZip from "adm-zip";
import { spawn, spawnSync } from "child_process";
import { download } from "common/download";
import { fileExists } from "common/utils";
import { remote } from "electron";
import * as fs from "fs-extra";
import path from "path";
import { lt } from "semver";

import { DolphinType, findDolphinExecutable } from "./directories";

export async function assertDolphinInstallation(
  type: DolphinType,
  log: (message: string) => void
): Promise<void> {
  try {
    await findDolphinExecutable(type);
    log(`Found existing ${type} Dolphin executable.`);
    log(`Checking if we need to update`);
    const data = await getLatestReleaseData(type);
    const latestVersion = data.tag_name;
    const isOutdated = await compareDolphinVersion(type, latestVersion);
    if (isOutdated) {
      log(`${type} Dolphin installation is outdated. Downloading latest...`);
      const downloadedAsset = await downloadLatestDolphin(type, log);
      log(`Installing ${type} Dolphin...`);
      await installDolphin(type, downloadedAsset);
      return;
    }
    log("No update found...");
    return;
  } catch (err) {
    log(`Could not find ${type} Dolphin installation. Downloading...`);
    const downloadedAsset = await downloadLatestDolphin(type, log);
    log(`Installing ${type} Dolphin...`);
    await installDolphin(type, downloadedAsset);
  }
}

export async function assertDolphinInstallations(
  log: (message: string) => void
): Promise<void> {
  await assertDolphinInstallation(DolphinType.NETPLAY, log);
  await assertDolphinInstallation(DolphinType.PLAYBACK, log);
  return;
}

async function compareDolphinVersion(
  type: DolphinType,
  latestVersion: string
): Promise<boolean> {
  const dolphinPath = await findDolphinExecutable(type);
  const dolphinVersion = spawnSync(dolphinPath, [
    "--version",
  ]).stdout.toString();
  return lt(latestVersion, dolphinVersion);
}

export async function openDolphin(type: DolphinType, params?: string[]) {
  const dolphinPath = await findDolphinExecutable(type);
  spawn(dolphinPath, params);
}

async function getLatestDolphinAsset(type: DolphinType): Promise<any> {
  const release = await getLatestReleaseData(type);
  const asset = release.assets.find((a: any) => matchesPlatform(a.name));
  if (!asset) {
    throw new Error("Could not fetch latest release");
  }
  return asset;
}

async function getLatestReleaseData(type: DolphinType): Promise<any> {
  const owner = "project-slippi";
  let repo = "Ishiiruka";
  if (type === DolphinType.PLAYBACK) {
    repo += "-Playback";
  }
  return getLatestRelease(owner, repo);
}

async function getLatestRelease(owner: string, repo: string): Promise<any> {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  const res = await fetch(url);
  const data = await res.json();
  return data;
}

function matchesPlatform(releaseName: string): boolean {
  switch (process.platform) {
    case "win32":
      return releaseName.endsWith("Win.zip");
    case "darwin":
      return releaseName.endsWith("Mac.zip");
    case "linux":
      return releaseName.endsWith(".AppImage");
    default:
      return false;
  }
}

async function downloadLatestDolphin(
  type: DolphinType,
  log: (status: string) => void = console.log
): Promise<string> {
  const asset = await getLatestDolphinAsset(type);
  const downloadLocation = path.join(remote.app.getPath("temp"), asset.name);
  const exists = await fileExists(downloadLocation);
  if (!exists) {
    log(`Downloading ${asset.browser_download_url} to ${downloadLocation}`);
    await download(asset.browser_download_url, downloadLocation, (percent) =>
      log(`Downloading... ${(percent * 100).toFixed(0)}%`)
    );
    log(
      `Successfully downloaded ${asset.browser_download_url} to ${downloadLocation}`
    );
  } else {
    log(`${downloadLocation} already exists. Skipping download.`);
  }
  return downloadLocation;
}

async function installDolphin(
  type: DolphinType,
  assetPath: string,
  log: (message: string) => void = console.log
) {
  const dolphinPath = path.join(remote.app.getPath("userData"), type);
  switch (process.platform) {
    case "win32": {
      const userFolderPath = path.join(dolphinPath, "User");
      const bkpUserFolderPath = path.join(
        remote.app.getPath("userData"),
        "Userbkp"
      );

      const zip = new AdmZip(assetPath);
      const alreadyInstalled = await fs.pathExists(dolphinPath);
      if (alreadyInstalled) {
        log(
          `${dolphinPath} already exists. Backing up User folder and deleting ${type} dolphin...`
        );
        await fs.move(userFolderPath, bkpUserFolderPath);
        await fs.remove(dolphinPath);
      }

      log(`Extracting to: ${dolphinPath}`);
      zip.extractAllTo(dolphinPath, true);
      if (alreadyInstalled) await fs.move(bkpUserFolderPath, userFolderPath);
      break;
    }
    case "darwin": {
      const extractToLocation = dolphinPath;
      if (await fs.pathExists(extractToLocation)) {
        log(`${extractToLocation} already exists. Deleting...`);
        await fs.remove(extractToLocation);
      } else {
        // Ensure the directory exists
        await fs.ensureDir(extractToLocation);
      }
      const zip = new AdmZip(assetPath);
      log(`Extracting to: ${extractToLocation}`);
      zip.extractAllTo(extractToLocation, true);
      break;
    }
    case "linux": {
      // Delete the existing app image if there is one
      try {
        const dolphinAppImagePath = await findDolphinExecutable(type);
        // Delete the existing app image if it already exists
        if (await fileExists(dolphinAppImagePath)) {
          log(`${dolphinAppImagePath} already exists. Deleting...`);
          await fs.remove(dolphinAppImagePath);
        }
      } catch (err) {
        // There's no app image
        log("No existing AppImage found");
      }

      const assetFilename = path.basename(assetPath);
      const targetLocation = path.join(dolphinPath, assetFilename);

      // Actually move the app image to the correct folder
      log(`Moving ${assetPath} to ${targetLocation}`);
      await fs.rename(assetPath, targetLocation);

      // Make the file executable
      log(`Setting executable permissions...`);
      await fs.chmod(targetLocation, "755");
      break;
    }
    default: {
      throw new Error(
        `Installing Netplay is not supported on this platform: ${process.platform}`
      );
    }
  }
}

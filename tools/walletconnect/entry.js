// Browser entry for the vault page: the WalletConnect provider (no AppKit modal) and a QR encoder.
import { EthereumProvider } from "@walletconnect/ethereum-provider";
import qrcode from "qrcode-generator";

window.OxvaWC = { EthereumProvider, qrcode };

import { ethers } from "ethers"
import RoscaFactoryABI from "./RoscaFactory.json"

const FACTORY_ADDRESS = "YOUR_DEPLOYED_FACTORY_ADDRESS" // Replace with Truffle-deployed factory address

export function getFactoryContract(signer) {
    return new ethers.Contract(FACTORY_ADDRESS, RoscaFactoryABI.abi, signer)
}
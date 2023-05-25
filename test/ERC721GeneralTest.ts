import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  ERC721General,
  MinimalForwarder,
  MintManager,
  Observability,
  OwnerOnlyTokenManager,
  TotalLockedTokenManager,
} from "../types";
import { setupGeneral, setupSystem } from "./__utils__/helpers";

describe("ERC721General functionality", () => {
  let totalLockedTokenManager: TotalLockedTokenManager;
  let ownerOnlyTokenManager: OwnerOnlyTokenManager;
  let general: ERC721General;
  let initialPlatformExecutor: SignerWithAddress,
    mintManagerOwner: SignerWithAddress,
    editionsMetadataOwner: SignerWithAddress,
    platformPaymentAddress: SignerWithAddress,
    owner: SignerWithAddress,
    fan1: SignerWithAddress;

  let mintManager: MintManager;
  let trustedForwarder: MinimalForwarder;
  let observability: Observability;
  let generalImplementation: string;

  before(async () => {
    [initialPlatformExecutor, mintManagerOwner, editionsMetadataOwner, platformPaymentAddress, owner, fan1] =
      await ethers.getSigners();
    const {
      mintManagerProxy,
      minimalForwarder,
      observability: observabilityInstance,
      generalImplementationAddress,
    } = await setupSystem(
      platformPaymentAddress.address,
      mintManagerOwner.address,
      initialPlatformExecutor.address,
      editionsMetadataOwner.address,
      owner,
    );

    mintManager = mintManagerProxy;
    trustedForwarder = minimalForwarder;
    observability = observabilityInstance;
    generalImplementation = generalImplementationAddress;

    totalLockedTokenManager = await (await ethers.getContractFactory("TotalLockedTokenManager")).deploy();
    ownerOnlyTokenManager = await (await ethers.getContractFactory("OwnerOnlyTokenManager")).deploy();
  });

  beforeEach(async () => {
    general = await setupGeneral(
      observability.address,
      generalImplementation,
      trustedForwarder.address,
      mintManager.address,
      owner,
    );
  });

  describe("URIs", function () {
    beforeEach(async () => {
      // mint a couple tokens to validate uris
      await expect(general.registerMinter(owner.address)).to.emit(general, "MinterRegistrationChanged");

      await expect(general.mintSameAmountToMultipleRecipients([owner.address, fan1.address], 2)).to.emit(
        general,
        "Transfer",
      );
    });

    it("Base uri concatenation should be respected for tokens without overwritten uris", async function () {
      for (let i = 1; i <= 4; i++) {
        expect(await general.tokenURI(i)).to.equal(`baseUri/${i}`);
      }
    });

    describe("setBaseUri", function () {
      it("Cannot set to empty string", async function () {
        await expect(general.setBaseURI("")).to.be.revertedWith("Empty string");
      });

      it("If default manager is non-existent, invocation from non-owner fails", async function () {
        general = general.connect(fan1);
        await expect(general.setBaseURI("testing")).to.be.revertedWith("Not owner");
      });

      it("If default manager is non-existent, invocation from owner succeeds", async function () {
        await expect(general.setBaseURI("testing"))
          .to.emit(general, "BaseURISet")
          .withArgs("baseUri", "testing")
          .to.emit(observability, "BaseUriSet")
          .withArgs(general.address, "testing");

        for (let i = 1; i <= 4; i++) {
          expect(await general.tokenURI(i)).to.equal(`testing/${i}`);
        }
      });

      it("If default manager exists, invocation respects token manager", async function () {
        await expect(general.setDefaultTokenManager(ownerOnlyTokenManager.address)).to.emit(
          general,
          "DefaultTokenManagerChanged",
        );

        general = general.connect(fan1);
        await expect(general.setBaseURI("testing")).to.be.revertedWith("Can't update base uri");

        general = general.connect(owner);
        await expect(general.setBaseURI("testing")).to.emit(general, "BaseURISet").withArgs("baseUri", "testing");

        for (let i = 1; i <= 4; i++) {
          expect(await general.tokenURI(i)).to.equal(`testing/${i}`);
        }
      });
    });

    describe("setTokenUris", function () {
      it("ids and uris length cannot mismatch", async function () {
        await expect(general.setTokenURIs([1, 2], ["test"])).to.be.revertedWith("Mismatched array lengths");
      });

      it("If token manager is non-existent, invocation from non-owner fails", async function () {
        general = general.connect(fan1);
        await expect(general.setTokenURIs([1, 2], ["testing1", "testing2"])).to.be.revertedWith("Not owner");
      });

      it("If tokens manager is non-existent, invocation owner succeeds", async function () {
        await expect(general.setTokenURIs([1, 2], ["testing1", "testing2"]))
          .to.emit(general, "TokenURIsSet")
          .withArgs([1, 2], ["testing1", "testing2"]);

        for (let i = 1; i <= 2; i++) {
          expect(await general.tokenURI(i)).to.equal(`testing${i}`);
        }
        for (let i = 3; i <= 4; i++) {
          expect(await general.tokenURI(i)).to.equal(`baseUri/${i}`);
        }
      });

      it("If token manager exists either as a default or an overwriting token manager, invocation respects token manager", async function () {
        await expect(general.setDefaultTokenManager(ownerOnlyTokenManager.address)).to.emit(
          general,
          "DefaultTokenManagerChanged",
        );

        general = general.connect(fan1);
        await expect(general.setTokenURIs([1, 2], ["testing1", "testing2"])).to.be.revertedWith("Can't update");

        general = general.connect(owner);

        await expect(general.setTokenURIs([1, 2], ["testing1", "testing2"]))
          .to.emit(general, "TokenURIsSet")
          .withArgs([1, 2], ["testing1", "testing2"])
          .to.emit(observability, "TokenURIsSet")
          .withArgs(general.address, [1, 2], ["testing1", "testing2"]);

        for (let i = 1; i <= 2; i++) {
          expect(await general.tokenURI(i)).to.equal(`testing${i}`);
        }
        for (let i = 3; i <= 4; i++) {
          expect(await general.tokenURI(i)).to.equal(`baseUri/${i}`);
        }

        await expect(
          general.setGranularTokenManagers([1, 2], [totalLockedTokenManager.address, totalLockedTokenManager.address]),
        )
          .to.emit(general, "GranularTokenManagersSet")
          .to.emit(observability, "GranularTokenManagersSet");

        await expect(general.setTokenURIs([1, 2, 3], ["testing1", "testing2", "testing3"])).to.be.revertedWith(
          "Can't update",
        );

        await expect(general.setTokenURIs([2, 3], ["testing2", "testing3"])).to.be.revertedWith("Can't update");

        await expect(general.setTokenURIs([1, 3], ["testing1", "testing3"])).to.be.revertedWith("Can't update");

        await expect(general.setTokenURIs([3], ["testing3"]))
          .to.emit(general, "TokenURIsSet")
          .withArgs([3], ["testing3"]);

        for (let i = 1; i <= 3; i++) {
          expect(await general.tokenURI(i)).to.equal(`testing${i}`);
        }
        expect(await general.tokenURI(4)).to.equal(`baseUri/4`);
      });
    });
  });

  describe("Minting", function () {
    beforeEach(async function () {
      await expect(general.registerMinter(owner.address));

      expect(await general.tokenManager(0)).to.eql(ethers.constants.AddressZero);

      await expect(general.setLimitSupply(4)).to.emit(general, "LimitSupplySet").withArgs(4);
    });

    describe("mintOneToOneRecipient", function () {
      it("Non minter cannot call", async function () {
        general = general.connect(fan1);

        await expect(general.mintOneToOneRecipient(fan1.address)).to.be.revertedWith("Not minter");
      });

      it("Cannot mint if mint frozen", async function () {
        await expect(general.freezeMints()).to.emit(general, "MintsFrozen");

        await expect(general.mintOneToOneRecipient(fan1.address)).to.be.revertedWith("Mint frozen");
      });

      it("Can mint validly up until limit supply", async function () {
        for (let i = 1; i <= 4; i++) {
          await expect(general.mintOneToOneRecipient(fan1.address))
            .to.emit(general, "Transfer")
            .withArgs(ethers.constants.AddressZero, fan1.address, i);

          expect(await general.balanceOf(fan1.address)).to.equal(ethers.BigNumber.from(i));
          expect(await general.ownerOf(i)).to.equal(fan1.address);
        }

        await expect(general.mintOneToOneRecipient(fan1.address)).to.be.revertedWith("Over limit supply");

        await expect(general.setLimitSupply(0)).to.emit(general, "LimitSupplySet").withArgs(0);

        for (let i = 5; i <= 8; i++) {
          await expect(general.mintOneToOneRecipient(fan1.address))
            .to.emit(general, "Transfer")
            .withArgs(ethers.constants.AddressZero, fan1.address, i);

          expect(await general.balanceOf(fan1.address)).to.equal(ethers.BigNumber.from(i));
          expect(await general.ownerOf(i)).to.equal(fan1.address);
        }
      });
    });

    describe("mintAmountToOneRecipient", function () {
      it("Non minter cannot call", async function () {
        general = general.connect(fan1);

        await expect(general.mintAmountToOneRecipient(fan1.address, 2)).to.be.revertedWith("Not minter");
      });

      it("Cannot mint if mint frozen", async function () {
        await expect(general.freezeMints()).to.emit(general, "MintsFrozen");

        await expect(general.mintAmountToOneRecipient(fan1.address, 2)).to.be.revertedWith("Mint frozen");
      });

      it("Cannot mint more than limitSupply, in multiple variations", async function () {
        await expect(general.mintAmountToOneRecipient(fan1.address, 6)).to.be.revertedWith("Over limit supply");

        await expect(general.mintAmountToOneRecipient(fan1.address, 3))
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 1)
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 2)
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 3);

        await expect(general.mintAmountToOneRecipient(fan1.address, 3)).to.be.revertedWith("Over limit supply");

        await expect(general.setLimitSupply(0))
          .to.emit(general, "LimitSupplySet")
          .withArgs(0)
          .to.emit(observability, "LimitSupplySet")
          .withArgs(general.address, 0);

        await expect(general.mintAmountToOneRecipient(fan1.address, 3))
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 4)
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 5)
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 6);
      });

      it("Minter can mint validly (simple variation)", async function () {
        await expect(general.mintAmountToOneRecipient(fan1.address, 3))
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 1)
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 2)
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 3);

        expect((await general.balanceOf(fan1.address)).toNumber()).to.equal(3);

        for (let i = 1; i <= 3; i++) {
          expect(await general.ownerOf(i)).to.equal(fan1.address);
        }
      });

      it("Minter can mint validly (running variation)", async function () {
        for (let i = 0; i < 2; i++) {
          await expect(general.mintAmountToOneRecipient(fan1.address, 2))
            .to.emit(general, "Transfer")
            .withArgs(ethers.constants.AddressZero, fan1.address, 2 * i + 1)
            .to.emit(general, "Transfer")
            .withArgs(ethers.constants.AddressZero, fan1.address, 2 * i + 2);

          expect((await general.balanceOf(fan1.address)).toNumber()).to.equal((i + 1) * 2);

          for (let j = 1; j <= (i + 1) * 2; j++) {
            expect(await general.ownerOf(j)).to.equal(fan1.address);
          }
        }
      });
    });

    describe("mintOneToMultipleRecipients", function () {
      it("Non minter cannot call", async function () {
        general = general.connect(fan1);

        await expect(general.mintOneToMultipleRecipients([fan1.address])).to.be.revertedWith("Not minter");
      });

      it("Cannot mint if mint frozen", async function () {
        await expect(general.freezeMints()).to.emit(general, "MintsFrozen");

        await expect(general.mintOneToMultipleRecipients([fan1.address])).to.be.revertedWith("Mint frozen");
      });

      it("Cannot mint more than limitSupply, in multiple variations", async function () {
        const recipientAddresses = [fan1.address, fan1.address, fan1.address, fan1.address, fan1.address, fan1.address];
        await expect(general.mintOneToMultipleRecipients(recipientAddresses)).to.be.revertedWith("Over limit supply");

        await expect(general.mintOneToMultipleRecipients(recipientAddresses.slice(3)))
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 1)
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 2)
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 3);

        await expect(general.mintOneToMultipleRecipients(recipientAddresses.slice(3))).to.be.revertedWith(
          "Over limit supply",
        );

        await expect(general.setLimitSupply(0)).to.emit(general, "LimitSupplySet").withArgs(0);

        await expect(general.mintOneToMultipleRecipients(recipientAddresses.slice(3)))
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 4)
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 5)
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 6);
      });

      it("Minter can mint validly (simple variation)", async function () {
        const recipientAddresses = [fan1.address, owner.address, editionsMetadataOwner.address];
        await expect(general.mintOneToMultipleRecipients(recipientAddresses))
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 1)
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, owner.address, 2)
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, editionsMetadataOwner.address, 3);

        let i = 1;
        for (const recipient of recipientAddresses) {
          expect((await general.balanceOf(recipient)).toNumber()).to.equal(1);
          expect(await general.ownerOf(i)).to.equal(recipient);
          i += 1;
        }
      });

      it("Minter can mint validly (running variation)", async function () {
        const recipientAddresses = [fan1.address, owner.address];
        for (let i = 0; i < 2; i++) {
          await expect(general.mintOneToMultipleRecipients(recipientAddresses))
            .to.emit(general, "Transfer")
            .withArgs(ethers.constants.AddressZero, fan1.address, i * 2 + 1)
            .to.emit(general, "Transfer")
            .withArgs(ethers.constants.AddressZero, owner.address, i * 2 + 2);

          let j = 1;
          for (const recipient of recipientAddresses) {
            expect((await general.balanceOf(recipient)).toNumber()).to.equal(i + 1);
            expect(await general.ownerOf(i * 2 + j)).to.equal(recipient);
            j += 1;
          }
        }
      });
    });

    describe("mintSameAmountToMultipleRecipients", function () {
      it("Non minter cannot call", async function () {
        general = general.connect(fan1);

        await expect(general.mintSameAmountToMultipleRecipients([fan1.address], 2)).to.be.revertedWith("Not minter");
      });

      it("Cannot mint if mint frozen", async function () {
        await expect(general.freezeMints()).to.emit(general, "MintsFrozen");

        await expect(general.mintSameAmountToMultipleRecipients([fan1.address], 2)).to.be.revertedWith("Mint frozen");
      });

      it("Cannot mint more than limitSupply, in multiple variations", async function () {
        const recipientAddresses = [fan1.address, fan1.address, fan1.address];
        await expect(general.mintSameAmountToMultipleRecipients(recipientAddresses, 2)).to.be.revertedWith(
          "Over limit supply",
        );

        await expect(general.mintSameAmountToMultipleRecipients(recipientAddresses.slice(1), 2))
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 1)
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 2)
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 3)
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 4);

        await expect(general.mintSameAmountToMultipleRecipients(recipientAddresses.slice(1), 1)).to.be.revertedWith(
          "Over limit supply",
        );

        await expect(general.setLimitSupply(0)).to.emit(general, "LimitSupplySet").withArgs(0);

        await expect(general.mintSameAmountToMultipleRecipients(recipientAddresses.slice(1), 2))
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 5)
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 6)
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 7)
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 8);
      });

      it("Minter can mint validly (simple variation)", async function () {
        const recipientAddresses = [fan1.address, fan1.address, fan1.address];
        await expect(general.mintSameAmountToMultipleRecipients(recipientAddresses, 2)).to.be.revertedWith(
          "Over limit supply",
        );

        await expect(general.mintSameAmountToMultipleRecipients(recipientAddresses.slice(1), 2))
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 1)
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 2)
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 3)
          .to.emit(general, "Transfer")
          .withArgs(ethers.constants.AddressZero, fan1.address, 4);

        await expect(general.mintSameAmountToMultipleRecipients(recipientAddresses.slice(1), 2)).to.be.revertedWith(
          "Over limit supply",
        );
      });

      it("Minter can mint validly (complex variation)", async function () {
        const recipientAddresses = [fan1.address, owner.address];

        for (let i = 0; i < 2; i++) {
          await expect(general.mintSameAmountToMultipleRecipients(recipientAddresses, 2))
            .to.emit(general, "Transfer")
            .withArgs(ethers.constants.AddressZero, fan1.address, i * 4 + 1)
            .to.emit(general, "Transfer")
            .withArgs(ethers.constants.AddressZero, fan1.address, i * 4 + 2)
            .to.emit(general, "Transfer")
            .withArgs(ethers.constants.AddressZero, owner.address, i * 4 + 3)
            .to.emit(general, "Transfer")
            .withArgs(ethers.constants.AddressZero, owner.address, i * 4 + 4);

          let j = 0;
          for (const recipient of recipientAddresses) {
            expect((await general.balanceOf(recipient)).toNumber()).to.equal((i + 1) * 2);
            expect(await general.ownerOf(i * 4 + j * 2 + 1)).to.equal(recipient);
            expect(await general.ownerOf(i * 4 + j * 2 + 2)).to.equal(recipient);
            j += 1;
          }

          await expect(general.setLimitSupply(8)).to.emit(general, "LimitSupplySet").withArgs(8);
        }
      });
    });

    describe("mintSpecificTokenToOneRecipient", function () {
      it("Non minter cannot call", async function () {
        general = general.connect(fan1);

        await expect(general.mintSpecificTokenToOneRecipient(fan1.address, 1)).to.be.revertedWith("Not minter");
      });

      it("Cannot mint if mint frozen", async function () {
        await expect(general.freezeMints()).to.emit(general, "MintsFrozen");

        await expect(general.mintSpecificTokenToOneRecipient(fan1.address, 2)).to.be.revertedWith("Mint frozen");
      });

      it("Cannot mint token not in range, but can mint in-range ones", async function () {
        await expect(general.mintSpecificTokenToOneRecipient(fan1.address, 1)).to.emit(general, "Transfer");
        await expect(general.mintSpecificTokenToOneRecipient(fan1.address, 2)).to.emit(general, "Transfer");
        await expect(general.mintSpecificTokenToOneRecipient(fan1.address, 5)).to.be.revertedWith("Token not in range");
        await expect(general.mintSpecificTokenToOneRecipient(fan1.address, 3)).to.emit(general, "Transfer");
        await expect(general.mintSpecificTokenToOneRecipient(fan1.address, 4)).to.emit(general, "Transfer");
        await expect(general.mintSpecificTokenToOneRecipient(fan1.address, 5)).to.be.revertedWith("Token not in range");

        await expect(general.setLimitSupply(0)).to.emit(general, "LimitSupplySet").withArgs(0);

        await expect(general.mintSpecificTokenToOneRecipient(fan1.address, 5)).to.emit(general, "Transfer");
      });

      it("Cannot mint already minted token", async function () {
        await expect(general.mintSpecificTokenToOneRecipient(fan1.address, 4)).to.emit(general, "Transfer");
        await expect(general.mintSpecificTokenToOneRecipient(fan1.address, 4)).to.be.revertedWith(
          "ERC721: token minted",
        );
      });
    });

    describe("mintSpecificTokensToOneRecipient", function () {
      it("Non minter cannot call", async function () {
        general = general.connect(fan1);

        await expect(general.mintSpecificTokensToOneRecipient(fan1.address, [1, 2])).to.be.revertedWith("Not minter");
      });

      it("Cannot mint if mint frozen", async function () {
        await expect(general.freezeMints()).to.emit(general, "MintsFrozen");

        await expect(general.mintSpecificTokensToOneRecipient(fan1.address, [2])).to.be.revertedWith("Mint frozen");
      });

      it("Cannot mint token not in range, but can mint in-range ones", async function () {
        await expect(general.mintSpecificTokensToOneRecipient(fan1.address, [1, 4]))
          .to.emit(general, "Transfer")
          .to.emit(general, "Transfer");
        await expect(general.mintSpecificTokensToOneRecipient(fan1.address, [2, 5])).to.be.revertedWith(
          "Token not in range",
        );
        await expect(general.mintSpecificTokensToOneRecipient(fan1.address, [2, 3]))
          .to.emit(general, "Transfer")
          .to.emit(general, "Transfer");

        await expect(general.setLimitSupply(0)).to.emit(general, "LimitSupplySet").withArgs(0);

        await expect(general.mintSpecificTokensToOneRecipient(fan1.address, [6, 19, 20]))
          .to.emit(general, "Transfer")
          .to.emit(general, "Transfer")
          .to.emit(general, "Transfer");
      });

      it("Cannot mint already minted token", async function () {
        await expect(general.mintSpecificTokensToOneRecipient(fan1.address, [4, 1])).to.emit(general, "Transfer");
        await expect(general.mintSpecificTokensToOneRecipient(fan1.address, [2, 1, 3])).to.be.revertedWith(
          "ERC721: token minted",
        );
      });
    });

    describe("Contract metadata updates", function () {
      it("Owner can change the contract level metadata", async function () {
        general = general.connect(owner);

        await expect(general.setContractMetadata("new name", "new symbol", "new contract uri"))
          .to.emit(observability, "ContractMetadataSet")
          .withArgs(general.address, "new name", "new symbol", "new contract uri");

        expect(await general.name()).to.equal("new name");
        expect(await general.symbol()).to.equal("new symbol");
        expect(await general.contractURI()).to.equal("new contract uri");
      });

      it("Non-owners cannot change the contract level metadata", async function () {
        general = general.connect(fan1);
        await expect(general.setContractMetadata("new name", "new symbol", "new contract uri")).to.be.revertedWith(
          "Ownable: caller is not the owner",
        );

        general = general.connect(editionsMetadataOwner);
        await expect(general.setContractMetadata("new name", "new symbol", "new contract uri")).to.be.revertedWith(
          "Ownable: caller is not the owner",
        );
      });
    });
  });
});

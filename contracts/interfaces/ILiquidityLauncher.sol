// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Adapter ke mesin likuiditas (mis. Doppler Airlock / Uniswap v4 + hook).
/// Launchpad tidak peduli detail pool-nya; adapter yang menerjemahkan ke Doppler.
interface ILiquidityLauncher {
    /// @param token          token yang baru dibuat
    /// @param amount         jumlah token untuk pool (sudah di-approve ke adapter)
    /// @param feeRecipient   alamat FeeSplitter yang menerima porsi fee creator+platform
    /// @param data           parameter pool khusus adapter (kurva harga, tick, quote token, dsb)
    /// @return pool          alamat/ID pool yang dibuat
    function seed(address token, uint256 amount, address feeRecipient, bytes calldata data)
        external
        payable
        returns (address pool);

    /// @notice Dev buy opsional di transaksi yang sama, token hasil beli dikirim ke `to`.
    function buy(address token, address to, uint256 minOut) external payable returns (uint256 amountOut);
}

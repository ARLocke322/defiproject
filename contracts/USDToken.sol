// contracts/GLDToken.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract USDToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    error CallerNotMinter(address caller);
    error CallerNotBurner(address caller);

    constructor(address admin, address minter, address burner) ERC20("USDToken", "USDTKN") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, minter);
        _grantRole(BURNER_ROLE, burner);
    }

    function mint(address to, uint256 amount) public {
        if (!hasRole(MINTER_ROLE, msg.sender)) {
            revert CallerNotMinter(msg.sender);
        }
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) public {
        if (!hasRole(BURNER_ROLE, msg.sender)) {
            revert CallerNotBurner(msg.sender);
        }
        _burn(from, amount);
    }
}

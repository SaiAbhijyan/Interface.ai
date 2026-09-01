(function (global) {
  var MEMBERS = {
    '10001': {
      id: '10001',
      name: 'Alice Rivera',
      status: 'ACTIVE',
      accounts: [
        { type: 'SAVINGS', number: 'SAV-10001-01', balance: '$4,250.33' },
        { type: 'CHECKING', number: 'CHK-10001-01', balance: '$812.10' }
      ]
    },
    '10002': {
      id: '10002',
      name: 'Benjamin Cho',
      status: 'ACTIVE',
      accounts: [
        { type: 'SAVINGS', number: 'SAV-10002-01', balance: '$12,008.00' }
      ]
    },
    '20001': {
      id: '20001',
      name: 'Carla Nguyen',
      status: 'RESTRICTED',
      accounts: [
        { type: 'SAVINGS', number: 'SAV-20001-01', balance: '$0.00' }
      ]
    }
  };

  var seq = 100;

  global.BankLogic = {
    findMember: function (id) {
      return MEMBERS[String(id)] || null;
    },
    openSubAccount: function (memberId, type, product) {
      seq += 1;
      var code = 'CNF-' + Date.now().toString(36).toUpperCase() + '-' + seq;
      var acct = type.slice(0, 3).toUpperCase() + '-' + memberId + '-' + String(seq).padStart(2, '0');
      return { confirmationCode: code, accountNumber: acct, product: product };
    },
    listMembers: function () {
      return Object.keys(MEMBERS);
    }
  };
})(window);

interface FinancialInstitution {
	/** the institution name */
	name: string;
	/** the 'fid' required for logon to the ofx server */
	fid: string;
	/** the 'org' required for logon to the ofx server */
	org: string;
	/** the URL of the ofx server */
	ofx: string;
	/** the profile returned by the ofx server */
	profile: FinancialInstitutionProfile;
}

interface FinancialInstitutionProfile {
	address1: string;
	address2: string;
	address3: string;
	city: string;
	state: string;
	zip: string;
	country: string;
	email: string;
	customerServicePhone: string;
	technicalSupportPhone: string;
	fax: string;
	financialInstitutionName: string;
	siteURL: string;
}

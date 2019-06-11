package accesstoken

import (
	"context"
	"crypto/rsa"

	jwt "github.com/dgrijalva/jwt-go"
	"github.com/go-gorp/gorp"

	"github.com/ovh/cds/engine/api/cache"
	"github.com/ovh/cds/sdk"
	"github.com/ovh/cds/sdk/log"
)

var (
	LocalIssuer string
	signingKey  *rsa.PrivateKey
	verifyKey   *rsa.PublicKey
)

// Init the package by passing the signing key
func Init(issuer string, k []byte) error {
	LocalIssuer = issuer
	var err error
	signingKey, err = jwt.ParseRSAPrivateKeyFromPEM(k)
	if err != nil {
		return sdk.WithStack(err)
	}
	verifyKey = &signingKey.PublicKey
	return nil
}

// IsValid checks a jwt token against all access_token
func IsValid(db gorp.SqlExecutor, jwtToken string) (*sdk.AuthSession, bool, error) {
	token, err := VerifyToken(jwtToken)
	if err != nil {
		return nil, false, sdk.WrapError(err, "invalid token")
	}

	claims := token.Claims.(*sdk.AuthSessionJWTClaims)
	id := claims.StandardClaims.Id

	// Load the access token from the id read in the claim
	accessToken, err := LoadSessionByID(context.Background(), db, id, LoadSessionOptions.WithGroups)
	if err != nil {
		return nil, false, sdk.WrapError(sdk.ErrUnauthorized, "unable find access token %s: %v", id, err)
	}
	if accessToken == nil {
		log.Debug("accesstoken.IsValid> no token found for id: %s", id)
		return nil, false, nil
	}

	// Check groups from the claims againts the groups in the database
	ids := accessToken.GroupIDs
	for _, groupID := range claims.GroupIDs {
		if !sdk.IsInInt64Array(groupID, ids) {
			log.Debug("accesstoken.IsValid> token %s is invalid (group mismatch): %v", id, err)
			return nil, false, nil
		}
	}

	return accessToken, token != nil, nil
}

var _XSRFTokenDuration = 60 * 60 * 24 * 7 // 1 Week

// StoreXSRFToken generate and store a CSRF token for a given access_token
func StoreXSRFToken(store cache.Store, sessionID string) string {
	log.Debug("accesstoken.StoreXSRFToken")
	var xsrfToken = sdk.UUID()
	var k = cache.Key("token", "xsrf", sessionID)
	store.SetWithTTL(k, &xsrfToken, _XSRFTokenDuration)
	return xsrfToken
}

// CheckXSRFToken checks a value "xsrfToken" against the access token CSRF generated by the API
func CheckXSRFToken(store cache.Store, sessionID, xsrfToken string) bool {
	log.Debug("accesstoken.CheckXSRFToken")
	var expectedXSRFfToken string
	var k = cache.Key("token", "xsrf", sessionID)
	if store.Get(k, &expectedXSRFfToken) {
		return expectedXSRFfToken == xsrfToken
	}
	return false
}

// VerifyToken checks token technical validity
func VerifyToken(jwtToken string) (*jwt.Token, error) {
	token, err := jwt.ParseWithClaims(jwtToken, &sdk.AuthSessionJWTClaims{},
		func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
				return nil, sdk.NewErrorFrom(sdk.ErrUnauthorized, "unexpected signing method: %v", token.Header["alg"])
			}
			return verifyKey, nil
		})

	if err != nil {
		return nil, sdk.WithStack(err)
	}

	if claims, ok := token.Claims.(*sdk.AuthSessionJWTClaims); ok && token.Valid {
		log.Debug("accesstoken.VerifyToken> token is valid %v %v", claims.Issuer, claims.StandardClaims.ExpiresAt)
	} else {
		return nil, sdk.WithStack(sdk.ErrUnauthorized)
	}

	return token, nil
}

func GetSigningKey() *rsa.PrivateKey {
	if signingKey == nil {
		panic("signing rsa private key is not set")
	}
	return signingKey
}

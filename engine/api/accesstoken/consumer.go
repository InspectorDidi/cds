package accesstoken

import (
	"time"

	"github.com/go-gorp/gorp"

	"github.com/ovh/cds/sdk"
)

// NewConsumerBuiltin returns a new builtin consumer for given data.
func NewConsumerBuiltin(db gorp.SqlExecutor, name, description, userID string, groupIDs []int64, scopes []string) (*sdk.AuthConsumer, error) {
	c := sdk.AuthConsumer{
		ID:                 sdk.UUID(),
		Name:               name,
		Description:        description,
		AuthentifiedUserID: userID,
		Type:               sdk.ConsumerBuiltin,
		Data:               map[string]string{},
		GroupIDs:           groupIDs,
		Scopes:             scopes,
		Created:            time.Now(),
	}

	if err := InsertConsumer(db, &c); err != nil {
		return nil, err
	}

	return &c, nil
}
